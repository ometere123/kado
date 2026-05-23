// Test script: create a 1 RLO x 5 payments x 60-second schedule, then monitor
// it against the running /api/crank to confirm fully-automatic payments.
//
// Usage (from nexus-protocol root):
//   npx ts-node scripts/test-autopay.ts
//
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection, PublicKey, Keypair, SystemProgram, clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, transfer,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Streamline } from "../target/types/streamline";
import { RLO_MINT, RLO_DECIMALS } from "../shared/config";

const D = 10n ** BigInt(RLO_DECIMALS);
const toRaw = (n: bigint) => n * D;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loadKp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const loadIdl = (n: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", n + ".json"), "utf8"));

const CRANK_URL = "http://localhost:3000/api/crank";

async function callCrank(payer: string, recipient: string): Promise<any> {
  const res = await fetch(CRANK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payer, recipient }),
  });
  return res.json();
}

async function main() {
  const deployerPath =
    process.env.DEPLOYER_KEYPAIR ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const deployer = loadKp(deployerPath);
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(deployer),
    { commitment: "confirmed" }
  );

  const rloMint = new PublicKey(RLO_MINT);
  const streamProg = new Program<Streamline>(loadIdl("streamline"), provider);
  const STREAMLINE_PK = streamProg.programId;

  // Create a fresh recipient keypair for this test
  const recipient = Keypair.generate();
  console.log("\n=== AUTO-PAY TEST ===");
  console.log("Payer:    ", deployer.publicKey.toBase58());
  console.log("Recipient:", recipient.publicKey.toBase58());

  // Ensure deployer has an RLO ATA
  const payerAta = (
    await getOrCreateAssociatedTokenAccount(connection, deployer, rloMint, deployer.publicKey)
  ).address;

  const payerBal = await connection.getTokenAccountBalance(payerAta);
  console.log("Payer RLO balance:", payerBal.value.uiAmount);

  // Derive PDAs
  const [schedulePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("schedule"), deployer.publicKey.toBuffer(), recipient.publicKey.toBuffer()],
    STREAMLINE_PK
  );
  const escrowAta = getAssociatedTokenAddressSync(rloMint, schedulePda, true);
  const recipientAta = getAssociatedTokenAddressSync(rloMint, recipient.publicKey);

  // Create schedule: 1 RLO x 5 payments x 60s interval
  const PER_PAYMENT = toRaw(1n);
  const INTERVAL = 60; // seconds
  const TOTAL = 5;

  const existing = await connection.getAccountInfo(schedulePda);
  if (existing) {
    console.log("Schedule already exists at", schedulePda.toBase58());
  } else {
    console.log("\nCreating schedule: 1 RLO x 5 x every 60s ...");
    const sig = await streamProg.methods
      .createSchedule(
        recipient.publicKey,
        new BN(PER_PAYMENT.toString()),
        new BN(INTERVAL),
        TOTAL
      )
      .accounts({
        schedule: schedulePda,
        rloMint,
        escrowTokenAccount: escrowAta,
        payerTokenAccount: payerAta,
        recipientAccount: recipient.publicKey,
        payer: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([deployer])
      .rpc();
    console.log("Schedule created. Tx:", sig);
    await sleep(2000);
  }

  // Monitor loop — poll every 15s, call crank when due, stop when complete
  console.log("\nMonitoring (polling every 15s, calling /api/crank when due)...\n");
  const payerStr = deployer.publicKey.toBase58();
  const recipientStr = recipient.publicKey.toBase58();
  let lastProgress = -1;

  for (let i = 0; i < 60; i++) {
    const acc = await (streamProg.account as any).paymentSchedule.fetchNullable(schedulePda);
    if (!acc) {
      console.log("Schedule account gone — test complete.");
      break;
    }

    const made = Number(acc.paymentsMade);
    const total = Number(acc.totalPayments);
    const lastExec = Number(acc.lastExecuted);
    const interval = Number(acc.intervalSeconds);
    const nowSec = Math.floor(Date.now() / 1000);
    const nextAt = lastExec + interval;
    const due = nowSec >= nextAt;
    const eta = due ? 0 : nextAt - nowSec;

    if (made !== lastProgress) {
      console.log(`[${new Date().toISOString()}] Progress: ${made}/${total} | escrow: ${Number(acc.escrowBalance) / Number(D)} RLO | next: ${due ? "NOW" : eta + "s"}`);
      lastProgress = made;
    }

    if (made >= total) {
      console.log("\n✅ All 5 payments complete — auto-pay works correctly!");
      break;
    }

    if (due) {
      process.stdout.write(`  → Calling /api/crank ... `);
      try {
        const result = await callCrank(payerStr, recipientStr);
        if (result.ok) {
          console.log(`✓ Payment fired! Tx: ${result.signature}`);
        } else if (result.skipped) {
          console.log(`skipped (${result.reason})`);
        } else {
          console.log(`error: ${result.error}`);
        }
      } catch (e: any) {
        console.log(`fetch failed: ${e.message}`);
      }
      await sleep(3000); // wait for RPC to settle
    }

    await sleep(15_000);
  }
}

main().catch(console.error);
