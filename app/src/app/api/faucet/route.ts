// $RLO devnet faucet.
//
// POST /api/faucet
// Body: { wallet: string }   (base58 Solana address)
// GET  /api/faucet?wallet=…   → check claim status without sending
//
// Reads FAUCET_KEYPAIR from env (base58-encoded 64-byte secret key),
// sends FAUCET_AMOUNT_WHOLE $RLO from the faucet's ATA to the requested wallet.
// Creates the recipient ATA on the fly if it doesn't exist yet.
//
// Rate limit: one claim per wallet per 24h, persisted to a JSON file alongside
// the app so server restarts don't reset it. Concurrent writes are guarded
// with a read-modify-write retry loop.

import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import * as fs from "fs/promises";
import * as path from "path";

import { RLO_MINT, RLO_DECIMALS } from "@shared/config";

const FAUCET_AMOUNT_WHOLE = 1_000n;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CLAIMS_FILE = path.join(process.cwd(), "faucet-claims.json");

export const dynamic = "force-dynamic";

type ClaimsRecord = Record<string, { lastClaimedMs: number; signature?: string }>;

async function readClaims(): Promise<ClaimsRecord> {
  try {
    const buf = await fs.readFile(CLAIMS_FILE, "utf8");
    const parsed = JSON.parse(buf);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (e: any) {
    if (e?.code === "ENOENT") return {};
    // Corrupt file — start over rather than wedge the faucet.
    console.warn("faucet-claims.json unreadable; resetting:", e?.message);
    return {};
  }
}

async function writeClaims(claims: ClaimsRecord): Promise<void> {
  // Write to a temp file then rename — avoids partial writes if the process
  // is killed mid-flush.
  const tmp = CLAIMS_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(claims, null, 2), "utf8");
  await fs.rename(tmp, CLAIMS_FILE);
}

/** Read-modify-write with a small retry loop in case of concurrent claims.
 *  Returns `accepted: true` if the slot was reserved, or `false` with a
 *  Unix-ms timestamp telling the caller when the wallet may claim next. */
async function tryClaim(
  wallet: string
): Promise<{ accepted: boolean; nextClaimMs: number }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const claims = await readClaims();
    const prev = claims[wallet];
    const now = Date.now();
    if (prev && now - prev.lastClaimedMs < COOLDOWN_MS) {
      return { accepted: false, nextClaimMs: prev.lastClaimedMs + COOLDOWN_MS };
    }
    claims[wallet] = { lastClaimedMs: now };
    try {
      await writeClaims(claims);
      return { accepted: true, nextClaimMs: 0 };
    } catch {
      // Another writer beat us — retry.
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
    }
  }
  return { accepted: false, nextClaimMs: Date.now() };
}

async function recordSignature(wallet: string, signature: string) {
  const claims = await readClaims();
  if (claims[wallet]) {
    claims[wallet].signature = signature;
    await writeClaims(claims).catch(() => undefined);
  }
}

async function rollbackClaim(wallet: string) {
  const claims = await readClaims();
  delete claims[wallet];
  await writeClaims(claims).catch(() => undefined);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const walletStr = url.searchParams.get("wallet")?.trim();
  if (!walletStr) {
    return NextResponse.json({ error: "Missing `wallet`" }, { status: 400 });
  }
  try {
    new PublicKey(walletStr);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }
  const claims = await readClaims();
  const prev = claims[walletStr];
  if (!prev) {
    return NextResponse.json({ canClaim: true });
  }
  const cooldownLeft = prev.lastClaimedMs + COOLDOWN_MS - Date.now();
  return NextResponse.json({
    canClaim: cooldownLeft <= 0,
    lastClaimedMs: prev.lastClaimedMs,
    cooldownLeftMs: Math.max(0, cooldownLeft),
    signature: prev.signature,
  });
}

export async function POST(req: Request) {
  let payload: { wallet?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const walletStr = payload.wallet?.trim();
  if (!walletStr) {
    return NextResponse.json({ error: "Missing `wallet`" }, { status: 400 });
  }
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(walletStr);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const claimRes = await tryClaim(recipient.toBase58());
  if (!claimRes.accepted) {
    return NextResponse.json(
      {
        error: "Wait 24 hours between claims",
        nextClaimMs: claimRes.nextClaimMs,
      },
      { status: 429 }
    );
  }

  const secret = process.env.FAUCET_KEYPAIR;
  if (!secret) {
    await rollbackClaim(recipient.toBase58());
    return NextResponse.json(
      { error: "Faucet not configured (FAUCET_KEYPAIR missing)" },
      { status: 500 }
    );
  }

  let faucet: Keypair;
  try {
    faucet = Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    await rollbackClaim(recipient.toBase58());
    return NextResponse.json(
      { error: "FAUCET_KEYPAIR is not valid base58" },
      { status: 500 }
    );
  }

  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet");
  const connection = new Connection(rpc, "confirmed");
  const mint = new PublicKey(RLO_MINT);
  const faucetAta = getAssociatedTokenAddressSync(mint, faucet.publicKey);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient);

  const raw = FAUCET_AMOUNT_WHOLE * 10n ** BigInt(RLO_DECIMALS);

  try {
    const { Transaction } = await import("@solana/web3.js");
    const tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        faucet.publicKey,
        recipientAta,
        recipient,
        mint
      )
    );
    tx.add(
      createTransferInstruction(
        faucetAta,
        recipientAta,
        faucet.publicKey,
        Number(raw)
      )
    );
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = faucet.publicKey;
    tx.sign(faucet);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    await recordSignature(recipient.toBase58(), sig);

    return NextResponse.json({
      ok: true,
      signature: sig,
      explorer: `https://solana.fm/tx/${sig}?cluster=devnet-solana`,
      amount: FAUCET_AMOUNT_WHOLE.toString(),
      symbol: "$RLO",
    });
  } catch (e: any) {
    // The on-chain send failed — give the user their attempt back.
    await rollbackClaim(recipient.toBase58());
    console.error("faucet failed", e);
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
