// Encodes a Solana keypair JSON file (id.json format: u8 array of 64 bytes)
// into a base58 string, suitable for the FAUCET_KEYPAIR env var.
//
// Usage:
//   npx ts-node scripts/encode-keypair.ts ~/.config/solana/id.json
//
// SECURITY: the output is the FULL secret key. Never commit it. Drop it into
// app/.env.local only.

import * as fs from "fs";
import bs58 from "bs58";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx ts-node scripts/encode-keypair.ts <keypair.json>");
  process.exit(1);
}
const arr = JSON.parse(fs.readFileSync(path, "utf8")) as number[];
if (!Array.isArray(arr) || arr.length !== 64) {
  console.error("Expected 64-byte secret-key JSON array, got:", arr.length);
  process.exit(1);
}
console.log(bs58.encode(Uint8Array.from(arr)));
