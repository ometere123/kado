// Bootstrap the vault program on devnet.
//
//   1. initialize_treasury  (admin = dev wallet)
//   2. transfer 100_000 $RLO from dev wallet ATA into treasury ATA
//
// Idempotent: skips step 1 if the treasury PDA already exists.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transfer,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Vault } from "../target/types/vault";
import { RLO_MINT, RLO_DECIMALS, VAULT_PROGRAM_ID } from "../shared/config";

const TREASURY_FUNDING_WHOLE = 100_000n; // 100k $RLO

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}

async function main() {
  const keypairPath =
    process.env.DEPLOYER_KEYPAIR ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = new anchor.Wallet(loadKeypair(keypairPath));
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "target", "idl", "vault.json"),
      "utf8"
    )
  );
  const program = new Program<Vault>(idl, provider);

  const rloMint = new PublicKey(RLO_MINT);
  console.log(`Admin:        ${wallet.publicKey.toBase58()}`);
  console.log(`RLO mint:     ${rloMint.toBase58()}`);
  console.log(`Vault prog:   ${VAULT_PROGRAM_ID}`);

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );
  const treasuryAta = getAssociatedTokenAddressSync(rloMint, treasuryPda, true);
  console.log(`Treasury:     ${treasuryPda.toBase58()}`);
  console.log(`Treasury ATA: ${treasuryAta.toBase58()}`);

  // Step 1: initialize_treasury (idempotent).
  const existing = await connection.getAccountInfo(treasuryPda);
  if (existing) {
    console.log("✓ Treasury PDA already exists, skipping init.");
  } else {
    const sig = await program.methods
      .initializeTreasury()
      .accounts({
        treasury: treasuryPda,
        rloMint,
        treasuryTokenAccount: treasuryAta,
        admin: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`✓ Treasury initialized. Tx: ${sig}`);
    console.log(
      `  Explorer: https://solana.fm/tx/${sig}?cluster=devnet-solana`
    );
  }

  // Step 2: fund treasury ATA from admin ATA.
  const adminAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      rloMint,
      wallet.publicKey
    )
  ).address;

  const treasuryBalance = await getAccount(connection, treasuryAta);
  const targetRaw =
    TREASURY_FUNDING_WHOLE * 10n ** BigInt(RLO_DECIMALS);

  if (treasuryBalance.amount >= targetRaw) {
    console.log(
      `✓ Treasury already has ${treasuryBalance.amount} base units (target ${targetRaw}). Skipping funding.`
    );
  } else {
    const toFund = targetRaw - treasuryBalance.amount;
    console.log(`Funding treasury with ${toFund} base units…`);
    const sig = await transfer(
      connection,
      wallet.payer,
      adminAta,
      treasuryAta,
      wallet.payer,
      Number(toFund)
    );
    console.log(`✓ Funded. Tx: ${sig}`);
    console.log(
      `  Explorer: https://solana.fm/tx/${sig}?cluster=devnet-solana`
    );
  }

  const finalBal = await getAccount(connection, treasuryAta);
  const whole = Number(finalBal.amount) / 10 ** RLO_DECIMALS;
  console.log(`Final treasury balance: ${whole.toLocaleString()} $RLO`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
