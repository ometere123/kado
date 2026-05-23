// Bootstrap the Flux AMM on devnet.
//
//   1. initialize_pool ($RLO/$USDC, 30 bps fee)  — admin = dev wallet
//   2. add_liquidity initial seed: 100_000 $RLO + 100_000 $USDC (1:1 starting price)
//
// Idempotent: skips step 1 if the pool PDA already exists; skips step 2 if reserves > 0.
//
// The pool seeds [pool, mint_a, mint_b] depend on canonical ordering of mints.
// We sort lexicographically to be deterministic regardless of which token was created first.

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
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
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { FluxAmm } from "../target/types/flux_amm";
import {
  RLO_MINT,
  USDC_MINT,
  FLUX_AMM_PROGRAM_ID,
  RLO_DECIMALS,
  USDC_DECIMALS,
} from "../shared/config";

const SEED_RLO_WHOLE = 100_000n;
const SEED_USDC_WHOLE = 100_000n;
const FEE_BPS = 30;

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}

/**
 * Canonical mint ordering for the pool PDA seeds.
 * Sorts the two mints lexicographically; returns [smaller, larger].
 */
function canonicalOrder(
  a: PublicKey,
  b: PublicKey
): [PublicKey, PublicKey] {
  return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
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
      path.join(__dirname, "..", "target", "idl", "flux_amm.json"),
      "utf8"
    )
  );
  const program = new Program<FluxAmm>(idl, provider);

  const rlo = new PublicKey(RLO_MINT);
  const usdc = new PublicKey(USDC_MINT);
  const [mintA, mintB] = canonicalOrder(rlo, usdc);
  const aIsRlo = mintA.equals(rlo);

  console.log(`Admin:        ${wallet.publicKey.toBase58()}`);
  console.log(`Flux program: ${FLUX_AMM_PROGRAM_ID}`);
  console.log(`Pair (A/B):   ${mintA.toBase58()} / ${mintB.toBase58()}`);
  console.log(`A = ${aIsRlo ? "$RLO" : "$USDC"}, B = ${aIsRlo ? "$USDC" : "$RLO"}`);

  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
    program.programId
  );
  const [lpMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), poolPda.toBuffer()],
    program.programId
  );
  const poolTokenA = getAssociatedTokenAddressSync(mintA, poolPda, true);
  const poolTokenB = getAssociatedTokenAddressSync(mintB, poolPda, true);

  console.log(`Pool PDA:     ${poolPda.toBase58()}`);
  console.log(`LP mint:      ${lpMintPda.toBase58()}`);

  // Step 1: initialize_pool (idempotent).
  const existing = await connection.getAccountInfo(poolPda);
  if (existing) {
    console.log("✓ Pool exists, skipping init.");
  } else {
    const sig = await program.methods
      .initializePool(FEE_BPS)
      .accounts({
        pool: poolPda,
        mintA,
        mintB,
        lpMint: lpMintPda,
        poolTokenA,
        poolTokenB,
        admin: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`✓ Pool initialized. Tx: ${sig}`);
    console.log(`  Explorer: https://solana.fm/tx/${sig}?cluster=devnet-solana`);
  }

  // Step 2: seed initial liquidity (idempotent — only if reserves are 0).
  const pool = await (program.account as any).ammPool.fetch(poolPda);
  const reservesEmpty =
    pool.tokenAReserve.toString() === "0" && pool.tokenBReserve.toString() === "0";

  if (!reservesEmpty) {
    console.log(
      `✓ Pool already seeded (A=${pool.tokenAReserve}, B=${pool.tokenBReserve}). Skipping.`
    );
    return;
  }

  // Make sure admin has both ATAs + the LP-token ATA.
  const adminAtaA = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintA,
      wallet.publicKey
    )
  ).address;
  const adminAtaB = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintB,
      wallet.publicKey
    )
  ).address;
  const adminLpAccount = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      lpMintPda,
      wallet.publicKey
    )
  ).address;

  // Compute raw amounts. A = the canonical-first mint, B = the other.
  const seedRloRaw = SEED_RLO_WHOLE * 10n ** BigInt(RLO_DECIMALS);
  const seedUsdcRaw = SEED_USDC_WHOLE * 10n ** BigInt(USDC_DECIMALS);
  const amountA = aIsRlo ? seedRloRaw : seedUsdcRaw;
  const amountB = aIsRlo ? seedUsdcRaw : seedRloRaw;

  console.log(
    `Seeding liquidity: A=${amountA} (${aIsRlo ? "$RLO" : "$USDC"}), B=${amountB} (${aIsRlo ? "$USDC" : "$RLO"})`
  );

  const sig = await program.methods
    .addLiquidity(new BN(amountA.toString()), new BN(amountB.toString()))
    .accounts({
      pool: poolPda,
      lpMint: lpMintPda,
      poolTokenA,
      poolTokenB,
      userTokenA: adminAtaA,
      userTokenB: adminAtaB,
      userLpAccount: adminLpAccount,
      user: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  console.log(`✓ Initial liquidity added. Tx: ${sig}`);
  console.log(`  Explorer: https://solana.fm/tx/${sig}?cluster=devnet-solana`);

  const after = await (program.account as any).ammPool.fetch(poolPda);
  console.log(`Final reserves: A=${after.tokenAReserve}, B=${after.tokenBReserve}`);
  console.log(`LP supply:      ${after.lpSupply}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
