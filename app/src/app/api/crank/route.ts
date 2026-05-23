// POST /api/crank
// Body: { payer: string; recipient: string }
//
// Server-side crank: executes a due Streamline payment using the CRANK_KEYPAIR
// server wallet. No user signature required — the cranker can be any funded wallet.

import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";

import streamlineIdl from "@idl/streamline.json";
import type { Streamline } from "@idl-types/streamline";
import { STREAMLINE_PROGRAM_ID, RLO_MINT } from "@shared/config";

export const dynamic = "force-dynamic";

const STREAMLINE_PK = new PublicKey(STREAMLINE_PROGRAM_ID);
const RLO_MINT_PK = new PublicKey(RLO_MINT);

function schedulePda(payer: PublicKey, recipient: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("schedule"), payer.toBuffer(), recipient.toBuffer()],
    STREAMLINE_PK
  )[0];
}

export async function POST(req: Request) {
  let body: { payer?: string; recipient?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { payer: payerStr, recipient: recipientStr } = body;
  if (!payerStr || !recipientStr) {
    return NextResponse.json({ error: "Missing payer or recipient" }, { status: 400 });
  }

  let payerPk: PublicKey, recipientPk: PublicKey;
  try {
    payerPk = new PublicKey(payerStr);
    recipientPk = new PublicKey(recipientStr);
  } catch {
    return NextResponse.json({ error: "Invalid public key" }, { status: 400 });
  }

  const secret = process.env.CRANK_KEYPAIR;
  if (!secret) {
    return NextResponse.json({ error: "CRANK_KEYPAIR not configured" }, { status: 500 });
  }

  let crankKp: Keypair;
  try {
    crankKp = Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    return NextResponse.json({ error: "Invalid CRANK_KEYPAIR" }, { status: 500 });
  }

  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet");
  const connection = new Connection(rpc, "confirmed");

  // Build a minimal Anchor-compatible wallet from the server keypair
  const crankWallet = {
    publicKey: crankKp.publicKey,
    signTransaction: async (tx: Transaction) => { tx.partialSign(crankKp); return tx; },
    signAllTransactions: async (txs: Transaction[]) => { txs.forEach((tx) => tx.partialSign(crankKp)); return txs; },
  };

  const provider = new AnchorProvider(connection, crankWallet as any, { commitment: "confirmed" });
  const prog = new Program(streamlineIdl as Idl, provider) as unknown as Program<Streamline>;

  const schedulePk = schedulePda(payerPk, recipientPk);
  const escrowAta = getAssociatedTokenAddressSync(RLO_MINT_PK, schedulePk, true);
  const recipientAta = getAssociatedTokenAddressSync(RLO_MINT_PK, recipientPk);

  // Check schedule exists and payment is due
  let schedule: any;
  try {
    schedule = await (prog.account as any).paymentSchedule.fetchNullable(schedulePk);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: "Schedule fetch failed: " + String(e?.message ?? e) }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  const nextAt = Number(schedule.lastExecuted) + Number(schedule.intervalSeconds);
  if (now < nextAt) {
    return NextResponse.json({
      skipped: true,
      reason: "IntervalNotElapsed",
      nextAt,
      now,
    });
  }

  if (Number(schedule.paymentsMade) >= Number(schedule.totalPayments)) {
    return NextResponse.json({ skipped: true, reason: "AllPaymentsMade" });
  }

  // Auto-create recipient ATA if missing
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        crankKp.publicKey,
        recipientAta,
        recipientPk,
        RLO_MINT_PK
      )
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    createAtaTx.recentBlockhash = blockhash;
    createAtaTx.lastValidBlockHeight = lastValidBlockHeight;
    createAtaTx.feePayer = crankKp.publicKey;
    createAtaTx.sign(crankKp);
    const ataSig = await connection.sendRawTransaction(createAtaTx.serialize());
    await connection.confirmTransaction({ signature: ataSig, blockhash, lastValidBlockHeight }, "confirmed");
  }

  try {
    const sig = await prog.methods
      .executePayment()
      .accounts({
        schedule: schedulePk,
        escrowTokenAccount: escrowAta,
        recipientTokenAccount: recipientAta,
        cranker: crankKp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .rpc();

    return NextResponse.json({ ok: true, signature: sig });
  } catch (e: any) {
    console.error("crank failed", e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
