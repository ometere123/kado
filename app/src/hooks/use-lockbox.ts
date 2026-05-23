"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";

import {
  buildProvider,
  lockboxProgram,
  transferPda,
  RLO_MINT_PK,
  LOCKBOX_PROGRAM_PK,
} from "@/lib/anchor";

export type ActiveTransfer = {
  pubkey: PublicKey;
  sender: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  expiry: number;
  claimed: boolean;
  nonce: Uint8Array;
};

function randomNonce(): Uint8Array {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return buf;
}

function decodeNonceFromInput(input: string): Uint8Array | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Accept either a raw base58 nonce or a `kado://claim/<base58>` URL.
  const base58 = trimmed.startsWith("kado://claim/")
    ? trimmed.slice("kado://claim/".length)
    : trimmed;
  try {
    const decoded = bs58.decode(base58);
    return decoded.length === 32 ? new Uint8Array(decoded) : null;
  } catch {
    return null;
  }
}

export function encodeClaimLink(nonce: Uint8Array): string {
  return `kado://claim/${bs58.encode(nonce)}`;
}

export { decodeNonceFromInput, randomNonce };

export function useLockbox() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [sent, setSent] = useState<ActiveTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  const fetchSent = useCallback(async () => {
    if (!wallet.publicKey) {
      setSent([]);
      return;
    }
    setLoading(true);
    try {
      const provider = buildProvider(connection, wallet as any);
      const prog = lockboxProgram(provider);
      const rows = await (prog.account as any).pendingTransfer.all([
        // PendingTransfer layout: 8 discriminator + sender(32) ...
        { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
      ]);
      const decoded: ActiveTransfer[] = rows.map((row: any) => ({
        pubkey: row.publicKey,
        sender: row.account.sender,
        recipient: row.account.recipient,
        amount: BigInt(row.account.amount.toString()),
        expiry: Number(row.account.expiryTimestamp.toString()),
        claimed: row.account.claimed,
        nonce: new Uint8Array(row.account.claimNonce),
      }));
      // Newest first (largest expiry → most-recently created).
      decoded.sort((a, b) => b.expiry - a.expiry);
      setSent(decoded);
    } catch (e) {
      console.error("fetchSent failed", e);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    fetchSent();
    const id = setInterval(fetchSent, 10_000);
    return () => clearInterval(id);
  }, [fetchSent, tick]);

  const createTransfer = useCallback(
    async (recipient: PublicKey, amount: bigint, expirySeconds: number) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = lockboxProgram(provider);
      const sender = wallet.publicKey;
      const nonce = randomNonce();
      const [transfer] = transferPda(sender, nonce);
      const senderAta = getAssociatedTokenAddressSync(RLO_MINT_PK, sender);
      const escrowAta = getAssociatedTokenAddressSync(RLO_MINT_PK, transfer, true);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .createTransfer(
            recipient,
            new BN(amount.toString()),
            new BN(expirySeconds),
            Array.from(nonce)
          )
          .accounts({
            transfer,
            rloMint: RLO_MINT_PK,
            escrowTokenAccount: escrowAta,
            senderTokenAccount: senderAta,
            sender,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        return { sig, nonce, transfer };
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  /** Find a PendingTransfer account by claim_nonce. Returns null if not found. */
  const findByNonce = useCallback(
    async (nonce: Uint8Array): Promise<ActiveTransfer | null> => {
      const provider = buildProvider(connection, wallet as any);
      const prog = lockboxProgram(provider);
      // claim_nonce sits at offset 8 (discriminator) + 32 (sender) + 32 (recipient)
      //   + 8 (amount) + 8 (expiry) + 1 (claimed) = 89 bytes.
      const rows = await (prog.account as any).pendingTransfer.all([
        { memcmp: { offset: 89, bytes: bs58.encode(nonce) } },
      ]);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        pubkey: r.publicKey,
        sender: r.account.sender,
        recipient: r.account.recipient,
        amount: BigInt(r.account.amount.toString()),
        expiry: Number(r.account.expiryTimestamp.toString()),
        claimed: r.account.claimed,
        nonce: new Uint8Array(r.account.claimNonce),
      };
    },
    [wallet, connection]
  );

  const claimByNonce = useCallback(
    async (nonce: Uint8Array) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const found = await findByNonce(nonce);
      if (!found) throw new Error("No matching transfer found.");
      if (found.claimed) throw new Error("Already claimed.");
      if (!found.recipient.equals(wallet.publicKey)) {
        throw new Error("This claim link isn't for you.");
      }
      const provider = buildProvider(connection, wallet as any);
      const prog = lockboxProgram(provider);
      const recipient = wallet.publicKey;
      const recipientAta = getAssociatedTokenAddressSync(RLO_MINT_PK, recipient);
      const escrowAta = getAssociatedTokenAddressSync(RLO_MINT_PK, found.pubkey, true);

      setSubmitting(true);
      try {
        // Auto-create recipient ATA if it does not exist yet
        const ataInfo = await connection.getAccountInfo(recipientAta);
        if (!ataInfo) {
          const createAtaTx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              recipient,
              recipientAta,
              recipient,
              RLO_MINT_PK,
            )
          );
          await (wallet as any).sendTransaction(createAtaTx, connection);
          await new Promise((r) => setTimeout(r, 2000));
        }
        const sig = await prog.methods
          .claim(Array.from(nonce))
          .accounts({
            transfer: found.pubkey,
            escrowTokenAccount: escrowAta,
            recipientTokenAccount: recipientAta,
            senderAccount: found.sender,
            recipient,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .rpc();
        return { sig, amount: found.amount };
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection, findByNonce]
  );

  const refundTransfer = useCallback(
    async (transfer: ActiveTransfer) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = lockboxProgram(provider);
      const sender = wallet.publicKey;
      const senderAta = getAssociatedTokenAddressSync(RLO_MINT_PK, sender);
      const escrowAta = getAssociatedTokenAddressSync(RLO_MINT_PK, transfer.pubkey, true);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .refund()
          .accounts({
            transfer: transfer.pubkey,
            escrowTokenAccount: escrowAta,
            senderTokenAccount: senderAta,
            sender,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .rpc();
        return sig;
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  return {
    sent,
    loading,
    submitting,
    createTransfer,
    claimByNonce,
    refundTransfer,
    findByNonce,
    refresh: () => setTick((t) => t + 1),
  };
}
