// Deploys the mock $USDC SPL token to Solana devnet (AMM pair for $RLO).
//
// Usage:
//   npx ts-node scripts/deploy-usdc.ts

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from "@solana/spl-token";

import { USDC_DECIMALS } from "../shared/config";

const INITIAL_SUPPLY_WHOLE = 1_000_000_000n; // 1 billion mock $USDC
const KEYPAIR_PATH =
  process.env.DEPLOYER_KEYPAIR ??
  path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}

function updateSharedConfig(mint: PublicKey) {
  const cfgPath = path.join(__dirname, "..", "shared", "config.ts");
  const src = fs.readFileSync(cfgPath, "utf8");
  const next = src.replace(
    /export const USDC_MINT =.*;/,
    `export const USDC_MINT = "${mint.toBase58()}";`
  );
  fs.writeFileSync(cfgPath, next);
  console.log(`✓ shared/config.ts updated with USDC_MINT = ${mint.toBase58()}`);
}

async function main() {
  const payer = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  console.log(`Deployer: ${payer.publicKey.toBase58()}`);
  const lamports = await connection.getBalance(payer.publicKey);
  console.log(`Balance:  ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (lamports < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error("Deployer balance too low. Fund and retry.");
  }

  console.log("Creating $USDC mint…");
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    USDC_DECIMALS
  );
  console.log(`Mint:     ${mint.toBase58()}`);

  const info = await getMint(connection, mint);
  if (info.decimals !== USDC_DECIMALS) {
    throw new Error(`decimals mismatch: ${info.decimals}`);
  }

  console.log("Creating deployer ATA…");
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  console.log(`ATA:      ${ata.address.toBase58()}`);

  const raw = INITIAL_SUPPLY_WHOLE * 10n ** BigInt(USDC_DECIMALS);
  console.log(`Minting ${INITIAL_SUPPLY_WHOLE.toLocaleString()} $USDC…`);
  const sig = await mintTo(
    connection,
    payer,
    mint,
    ata.address,
    payer,
    raw
  );
  console.log(`Mint tx:  ${sig}`);
  console.log(`Explorer: https://solana.fm/tx/${sig}?cluster=devnet-solana`);

  updateSharedConfig(mint);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
