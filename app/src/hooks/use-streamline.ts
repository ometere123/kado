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
  streamlineProgram,
  schedulePda,
  RLO_MINT_PK,
} from "@/lib/anchor";

export type Schedule = {
  exists: boolean;
  payer: PublicKey | null;
  recipient: PublicKey | null;
  amountPerPayment: bigint;
  intervalSeconds: number;
  paymentsMade: number;
  totalPayments: number;
  lastExecuted: number;
  escrowBalance: bigint;
};

const EMPTY: Schedule = {
  exists: false,
  payer: null,
  recipient: null,
  amountPerPayment: 0n,
  intervalSeconds: 0,
  paymentsMade: 0,
  totalPayments: 0,
  lastExecuted: 0,
  escrowBalance: 0n,
};

/**
 * Hook keyed by a single recipient — fetches the schedule for (connected wallet, recipient).
 * Pass null for `recipient` to disable fetch.
 */
export function useStreamline(recipient: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [schedule, setSchedule] = useState<Schedule>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  const pdas = useMemo(() => {
    if (!wallet.publicKey || !recipient) return null;
    const [sched] = schedulePda(wallet.publicKey, recipient);
    const escrowAta = getAssociatedTokenAddressSync(RLO_MINT_PK, sched, true);
    return { schedule: sched, escrowAta };
  }, [wallet.publicKey, recipient]);

  const fetchSchedule = useCallback(async () => {
    if (!wallet.publicKey || !recipient || !pdas) {
      setSchedule(EMPTY);
      return;
    }
    try {
      const provider = buildProvider(connection, wallet as any);
      const prog = streamlineProgram(provider);
      const acc = await (prog.account as any).paymentSchedule.fetchNullable(
        pdas.schedule
      );
      if (!acc) {
        setSchedule({ ...EMPTY });
        return;
      }
      setSchedule({
        exists: true,
        payer: new PublicKey(acc.payer),
        recipient: new PublicKey(acc.recipient),
        amountPerPayment: BigInt(acc.amountPerPayment.toString()),
        intervalSeconds: Number(acc.intervalSeconds.toString()),
        paymentsMade: acc.paymentsMade,
        totalPayments: acc.totalPayments,
        lastExecuted: Number(acc.lastExecuted.toString()),
        escrowBalance: BigInt(acc.escrowBalance.toString()),
      });
    } catch (e) {
      console.error("fetchSchedule failed", e);
      setSchedule(EMPTY);
    }
  }, [connection, wallet, recipient, pdas]);

  useEffect(() => {
    fetchSchedule();
    const id = setInterval(fetchSchedule, 5_000);
    return () => clearInterval(id);
  }, [fetchSchedule, tick]);

  // ---- writes ----

  const create = useCallback(
    async (params: {
      amountPerPayment: bigint;
      intervalSeconds: number;
      totalPayments: number;
    }) => {
      if (!wallet.publicKey || !recipient || !pdas) {
        throw new Error("Connect wallet and pick a recipient.");
      }
      const provider = buildProvider(connection, wallet as any);
      const prog = streamlineProgram(provider);
      const payer = wallet.publicKey;
      const payerAta = getAssociatedTokenAddressSync(RLO_MINT_PK, payer);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .createSchedule(
            recipient,
            new BN(params.amountPerPayment.toString()),
            new BN(params.intervalSeconds),
            params.totalPayments
          )
          .accounts({
            schedule: pdas.schedule,
            rloMint: RLO_MINT_PK,
            escrowTokenAccount: pdas.escrowAta,
            payerTokenAccount: payerAta,
            recipientAccount: recipient,
            payer,
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
    [wallet, connection, recipient, pdas]
  );

  const executeNow = useCallback(async () => {
    if (!wallet.publicKey || !recipient || !pdas)
      throw new Error("No schedule.");
    const provider = buildProvider(connection, wallet as any);
    const prog = streamlineProgram(provider);
    const recipientAta = getAssociatedTokenAddressSync(RLO_MINT_PK, recipient);

    setSubmitting(true);
    try {
      const sig = await prog.methods
        .executePayment()
        .accounts({
          schedule: pdas.schedule,
          escrowTokenAccount: pdas.escrowAta,
          recipientTokenAccount: recipientAta,
          cranker: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      return sig;
    } finally {
      setSubmitting(false);
      setTick((t) => t + 1);
    }
  }, [wallet, connection, recipient, pdas]);

  const cancel = useCallback(async () => {
    if (!wallet.publicKey || !recipient || !pdas)
      throw new Error("No schedule.");
    const provider = buildProvider(connection, wallet as any);
    const prog = streamlineProgram(provider);
    const payer = wallet.publicKey;
    const payerAta = getAssociatedTokenAddressSync(RLO_MINT_PK, payer);

    setSubmitting(true);
    try {
      const sig = await prog.methods
        .cancelSchedule()
        .accounts({
          schedule: pdas.schedule,
          escrowTokenAccount: pdas.escrowAta,
          payerTokenAccount: payerAta,
          payer,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      return sig;
    } finally {
      setSubmitting(false);
      setTick((t) => t + 1);
    }
  }, [wallet, connection, recipient, pdas]);

  const nextPaymentAt = useMemo(
    () =>
      schedule.exists && schedule.paymentsMade < schedule.totalPayments
        ? schedule.lastExecuted + schedule.intervalSeconds
        : null,
    [schedule]
  );

  return {
    schedule,
    submitting,
    create,
    executeNow,
    cancel,
    nextPaymentAt,
    refresh: () => setTick((t) => t + 1),
  };
}
