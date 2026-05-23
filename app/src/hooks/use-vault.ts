"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  buildProvider,
  vaultProgram,
  vaultPda,
  treasuryPda,
  RLO_MINT_PK,
} from "@/lib/anchor";

export type VaultState = {
  exists: boolean;
  stakedAmount: bigint;
  borrowedAmount: bigint;
  creditRating: number;
  haircutBps: number;
  lastUpdated: number;
};

const EMPTY: VaultState = {
  exists: false,
  stakedAmount: 0n,
  borrowedAmount: 0n,
  creditRating: 3,
  haircutBps: 7000,
  lastUpdated: 0,
};

export function useVault() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<VaultState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  const programReady = !!wallet.publicKey && !!wallet.signTransaction;

  const fetchState = useCallback(async () => {
    if (!wallet.publicKey) {
      setState(EMPTY);
      return;
    }
    setLoading(true);
    try {
      const provider = buildProvider(connection, wallet as any);
      const prog = vaultProgram(provider);
      const [pda] = vaultPda(wallet.publicKey);

      const acc = await (prog.account as any).collateralVault.fetchNullable(pda);
      if (!acc) {
        setState(EMPTY);
        return;
      }
      setState({
        exists: true,
        stakedAmount: BigInt(acc.stakedAmount.toString()),
        borrowedAmount: BigInt(acc.borrowedAmount.toString()),
        creditRating: acc.creditRating,
        haircutBps: acc.haircutBps,
        lastUpdated: Number(acc.lastUpdated.toString()),
      });
    } catch (e) {
      console.error("fetchState failed", e);
      setState(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [wallet, connection]);

  useEffect(() => {
    fetchState();
  }, [fetchState, tick]);

  // -------- writes --------

  const initialize = useCallback(
    async (creditRating: number, haircutBps: number) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = vaultProgram(provider);
      const owner = wallet.publicKey;
      const [pda] = vaultPda(owner);
      const ata = getAssociatedTokenAddressSync(RLO_MINT_PK, pda, true);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .initializeVault(creditRating, haircutBps)
          .accounts({
            vault: pda,
            rloMint: RLO_MINT_PK,
            vaultTokenAccount: ata,
            owner,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
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

  const stake = useCallback(
    async (rawAmount: bigint) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = vaultProgram(provider);
      const owner = wallet.publicKey;
      const [pda] = vaultPda(owner);
      const vaultAta = getAssociatedTokenAddressSync(RLO_MINT_PK, pda, true);
      const ownerAta = getAssociatedTokenAddressSync(RLO_MINT_PK, owner);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .stake(new BN(rawAmount.toString()))
          .accounts({
            vault: pda,
            vaultTokenAccount: vaultAta,
            ownerTokenAccount: ownerAta,
            rloMint: RLO_MINT_PK,
            owner,
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

  const borrow = useCallback(
    async (rawAmount: bigint) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = vaultProgram(provider);
      const owner = wallet.publicKey;
      const [pda] = vaultPda(owner);
      const [tPda] = treasuryPda();
      const tAta = getAssociatedTokenAddressSync(RLO_MINT_PK, tPda, true);
      const ownerAta = getAssociatedTokenAddressSync(RLO_MINT_PK, owner);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .borrow(new BN(rawAmount.toString()))
          .accounts({
            vault: pda,
            treasury: tPda,
            treasuryTokenAccount: tAta,
            ownerTokenAccount: ownerAta,
            rloMint: RLO_MINT_PK,
            owner,
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

  const repay = useCallback(
    async (rawAmount: bigint) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = vaultProgram(provider);
      const owner = wallet.publicKey;
      const [pda] = vaultPda(owner);
      const [tPda] = treasuryPda();
      const tAta = getAssociatedTokenAddressSync(RLO_MINT_PK, tPda, true);
      const ownerAta = getAssociatedTokenAddressSync(RLO_MINT_PK, owner);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .repay(new BN(rawAmount.toString()))
          .accounts({
            vault: pda,
            treasury: tPda,
            treasuryTokenAccount: tAta,
            ownerTokenAccount: ownerAta,
            rloMint: RLO_MINT_PK,
            owner,
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

  const withdraw = useCallback(
    async (rawAmount: bigint) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = vaultProgram(provider);
      const owner = wallet.publicKey;
      const [pda] = vaultPda(owner);
      const vaultAta = getAssociatedTokenAddressSync(RLO_MINT_PK, pda, true);
      const ownerAta = getAssociatedTokenAddressSync(RLO_MINT_PK, owner);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .withdraw(new BN(rawAmount.toString()))
          .accounts({
            vault: pda,
            vaultTokenAccount: vaultAta,
            ownerTokenAccount: ownerAta,
            rloMint: RLO_MINT_PK,
            owner,
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

  // Derived values
  const maxBorrow = useMemo(() => {
    const raw =
      (state.stakedAmount * BigInt(state.haircutBps)) / 10000n;
    return raw;
  }, [state.stakedAmount, state.haircutBps]);

  const remainingBorrow = useMemo(() => {
    if (maxBorrow <= state.borrowedAmount) return 0n;
    return maxBorrow - state.borrowedAmount;
  }, [maxBorrow, state.borrowedAmount]);

  const ltvPct = useMemo(() => {
    if (state.stakedAmount === 0n) return 0;
    return Number((state.borrowedAmount * 10000n) / state.stakedAmount) / 100;
  }, [state.stakedAmount, state.borrowedAmount]);

  return {
    state,
    loading,
    submitting,
    programReady,
    maxBorrow,
    remainingBorrow,
    ltvPct,
    initialize,
    stake,
    borrow,
    repay,
    withdraw,
    refresh: () => setTick((t) => t + 1),
  };
}
