// Deploys the mock $RLO SPL token to Solana devnet.
//
// Usage:
//   yarn deploy:token
//   # or
//   npx ts-node scripts/deploy-token.ts
//
// On success it prints the mint address and the ATA holding the initial supply,
// then writes RLO_MINT into ../shared/config.ts so the rest of the workspace
// picks it up automatically.

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

import { RLO_DECIMALS } from "../shared/config";

const INITIAL_SUPPLY_WHOLE = 1_000_000_000n; // 1 billion $RLO
const KEYPAIR_PATH =
  process.env.DEPLOYER_KEYPAIR ??
  path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function updateSharedConfig(mint: PublicKey) {
  const cfgPath = path.join(__dirname, "..", "shared", "config.ts");
  const src = fs.readFileSync(cfgPath, "utf8");
  const next = src.replace(
    /export const RLO_MINT =.*;/,
    `export const RLO_MINT = "${mint.toBase58()}";`
  );
  fs.writeFileSync(cfgPath, next);
  console.log(`✓ shared/config.ts updated with RLO_MINT = ${mint.toBase58()}`);
}

async function main() {
  const payer = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  console.log(`Deployer:  ${payer.publicKey.toBase58()}`);
  const lamports = await connection.getBalance(payer.publicKey);
  console.log(`Balance:   ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (lamports < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error(
      "Deployer balance too low (need ≳ 0.05 SOL). Fund it via https://faucet.solana.com and retry."
    );
  }

  console.log("Creating $RLO mint…");
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority — dev wallet retains it
    payer.publicKey, // freeze authority
    RLO_DECIMALS
  );
  console.log(`Mint:      ${mint.toBase58()}`);

  const mintInfo = await getMint(connection, mint);
  if (mintInfo.decimals !== RLO_DECIMALS) {
    throw new Error(
      `Mint decimals mismatch: expected ${RLO_DECIMALS}, got ${mintInfo.decimals}`
    );
  }

  console.log("Creating deployer ATA…");
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  console.log(`ATA:       ${ata.address.toBase58()}`);

  const rawSupply = INITIAL_SUPPLY_WHOLE * BigInt(10) ** BigInt(RLO_DECIMALS);
  console.log(
    `Minting ${INITIAL_SUPPLY_WHOLE.toLocaleString()} $RLO (${rawSupply} base units)…`
  );
  const sig = await mintTo(
    connection,
    payer,
    mint,
    ata.address,
    payer,
    rawSupply
  );
  console.log(`Mint tx:   ${sig}`);
  console.log(`Explorer:  https://solana.fm/tx/${sig}?cluster=devnet-solana`);

  updateSharedConfig(mint);

  console.log("\nDone. Next steps:");
  console.log("  1. Commit shared/config.ts");
  console.log("  2. Run `anchor deploy` to deploy the 5 programs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
