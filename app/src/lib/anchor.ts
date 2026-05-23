// Lightweight Anchor helpers for the frontend.
//
// Loads the per-program IDL JSONs from target/idl and gives back a
// typed Program instance bound to the current wallet/connection.

import { AnchorProvider, Program, Idl, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

import vaultIdl from "@idl/vault.json";
import fluxIdl from "@idl/flux_amm.json";
import streamlineIdl from "@idl/streamline.json";
import lockboxIdl from "@idl/lockbox.json";
import forgeIdl from "@idl/forge.json";
import type { Vault } from "@idl-types/vault";
import type { FluxAmm } from "@idl-types/flux_amm";
import type { Streamline } from "@idl-types/streamline";
import type { Lockbox } from "@idl-types/lockbox";
import type { Forge } from "@idl-types/forge";

import {
  VAULT_PROGRAM_ID,
  FLUX_AMM_PROGRAM_ID,
  STREAMLINE_PROGRAM_ID,
  LOCKBOX_PROGRAM_ID,
  FORGE_PROGRAM_ID,
  RLO_MINT,
  USDC_MINT,
} from "@shared/config";

export const VAULT_PROGRAM_PK = new PublicKey(VAULT_PROGRAM_ID);
export const FLUX_AMM_PROGRAM_PK = new PublicKey(FLUX_AMM_PROGRAM_ID);
export const STREAMLINE_PROGRAM_PK = new PublicKey(STREAMLINE_PROGRAM_ID);
export const LOCKBOX_PROGRAM_PK = new PublicKey(LOCKBOX_PROGRAM_ID);
export const FORGE_PROGRAM_PK = new PublicKey(FORGE_PROGRAM_ID);
export const RLO_MINT_PK = new PublicKey(RLO_MINT);
export const USDC_MINT_PK = new PublicKey(USDC_MINT);

/** Canonical ordering for flux-amm pool seeds. */
export function canonicalMintOrder(
  a: PublicKey,
  b: PublicKey
): [PublicKey, PublicKey] {
  return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
}

/**
 * Builds an AnchorProvider from a connection + wallet adapter wallet.
 * Wallet adapter's `publicKey/signTransaction/signAllTransactions` satisfy
 * Anchor's Wallet interface — we wrap them so types line up.
 */
export function buildProvider(
  connection: Connection,
  wallet: {
    publicKey: PublicKey | null;
    signTransaction: any;
    signAllTransactions: any;
  }
): AnchorProvider {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected.");
  }
  return new AnchorProvider(
    connection,
    wallet as unknown as Wallet,
    { commitment: "confirmed" }
  );
}

export function vaultProgram(provider: AnchorProvider): Program<Vault> {
  return new Program(vaultIdl as Idl, provider) as unknown as Program<Vault>;
}

export function fluxProgram(provider: AnchorProvider): Program<FluxAmm> {
  return new Program(fluxIdl as Idl, provider) as unknown as Program<FluxAmm>;
}

export function streamlineProgram(
  provider: AnchorProvider
): Program<Streamline> {
  return new Program(
    streamlineIdl as Idl,
    provider
  ) as unknown as Program<Streamline>;
}

export function lockboxProgram(provider: AnchorProvider): Program<Lockbox> {
  return new Program(
    lockboxIdl as Idl,
    provider
  ) as unknown as Program<Lockbox>;
}

export function forgeProgram(provider: AnchorProvider): Program<Forge> {
  return new Program(
    forgeIdl as Idl,
    provider
  ) as unknown as Program<Forge>;
}

// PDA helpers.
export function vaultPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    VAULT_PROGRAM_PK
  );
}

export function treasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    VAULT_PROGRAM_PK
  );
}

export function fluxPoolPda(mintA: PublicKey, mintB: PublicKey): [PublicKey, number] {
  const [a, b] = canonicalMintOrder(mintA, mintB);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), a.toBuffer(), b.toBuffer()],
    FLUX_AMM_PROGRAM_PK
  );
}

export function fluxLpMintPda(poolPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), poolPda.toBuffer()],
    FLUX_AMM_PROGRAM_PK
  );
}

export function schedulePda(
  payer: PublicKey,
  recipient: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("schedule"), payer.toBuffer(), recipient.toBuffer()],
    STREAMLINE_PROGRAM_PK
  );
}

/** Forge: task PDA, seeds = [b"task", poster, nonce as little-endian u64]. */
export function taskPda(
  poster: PublicKey,
  nonce: bigint
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("task"), poster.toBuffer(), buf],
    FORGE_PROGRAM_PK
  );
}

/** Forge: bid PDA, seeds = [b"bid", task, agent]. */
export function bidPda(
  task: PublicKey,
  agent: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), task.toBuffer(), agent.toBuffer()],
    FORGE_PROGRAM_PK
  );
}

/** Lockbox: transfer PDA, seeds = [b"transfer", sender, nonce]. */
export function transferPda(
  sender: PublicKey,
  nonce: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("transfer"), sender.toBuffer(), Buffer.from(nonce)],
    LOCKBOX_PROGRAM_PK
  );
}
