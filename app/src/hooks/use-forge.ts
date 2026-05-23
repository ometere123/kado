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
  forgeProgram,
  taskPda,
  bidPda,
  RLO_MINT_PK,
  FORGE_PROGRAM_PK,
} from "@/lib/anchor";

export type TaskStatus =
  | "open"
  | "assigned"
  | "submitted"
  | "approved"
  | "rejected";

export type ForgeTask = {
  pubkey: PublicKey;
  poster: PublicKey;
  agent: PublicKey;
  reward: bigint;
  status: TaskStatus;
  resultHash: Uint8Array;
  resultUri: string;
  deadline: number;
  description: string;
  nonce: bigint;
};

function decodeStatus(raw: any): TaskStatus {
  if (raw.open !== undefined) return "open";
  if (raw.assigned !== undefined) return "assigned";
  if (raw.submitted !== undefined) return "submitted";
  if (raw.approved !== undefined) return "approved";
  if (raw.rejected !== undefined) return "rejected";
  return "open";
}

function decodeTask(pubkey: PublicKey, raw: any): ForgeTask {
  return {
    pubkey,
    poster: raw.poster,
    agent: raw.agent,
    reward: BigInt(raw.reward.toString()),
    status: decodeStatus(raw.status),
    resultHash: new Uint8Array(raw.resultHash),
    resultUri: raw.resultUri,
    deadline: Number(raw.deadline.toString()),
    description: raw.description,
    nonce: BigInt(raw.nonce.toString()),
  };
}

export function useForge() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tasks, setTasks] = useState<ForgeTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  const fetchTasks = useCallback(async () => {
    if (!wallet.publicKey) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const all = await (prog.account as any).task.all();
      const decoded = all.map((row: any) => decodeTask(row.publicKey, row.account));
      // Sort: open tasks first, newest deadline first.
      decoded.sort((a: ForgeTask, b: ForgeTask) => {
        const rank = (t: ForgeTask) =>
          t.status === "open"
            ? 0
            : t.status === "assigned"
            ? 1
            : t.status === "submitted"
            ? 2
            : 3;
        const dr = rank(a) - rank(b);
        if (dr !== 0) return dr;
        return b.deadline - a.deadline;
      });
      setTasks(decoded);
    } catch (e) {
      console.error("forge fetchTasks failed", e);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    fetchTasks();
    const id = setInterval(fetchTasks, 8_000);
    return () => clearInterval(id);
  }, [fetchTasks, tick]);

  // ---------- writes ----------

  const postTask = useCallback(
    async (params: {
      description: string;
      reward: bigint;
      deadlineUnix: number;
    }) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const poster = wallet.publicKey;
      // Pick a u64 nonce derived from time + random tail.
      const nonce =
        (BigInt(Math.floor(Date.now() / 1000)) << 16n) |
        BigInt(Math.floor(Math.random() * 65535));

      const [task] = taskPda(poster, nonce);
      const escrowAta = getAssociatedTokenAddressSync(RLO_MINT_PK, task, true);
      const posterAta = getAssociatedTokenAddressSync(RLO_MINT_PK, poster);

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .postTask(
            new BN(nonce.toString()),
            params.description,
            new BN(params.reward.toString()),
            new BN(params.deadlineUnix)
          )
          .accounts({
            task,
            rloMint: RLO_MINT_PK,
            escrowTokenAccount: escrowAta,
            posterTokenAccount: posterAta,
            poster,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        return { sig, task };
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  const bid = useCallback(
    async (task: PublicKey) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const agent = wallet.publicKey;
      const [bidPdaKey] = bidPda(task, agent);

      setSubmitting(true);
      try {
        return await prog.methods
          .bidOnTask()
          .accounts({
            task,
            bid: bidPdaKey,
            agent,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  const assign = useCallback(
    async (task: PublicKey, agent: PublicKey) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const poster = wallet.publicKey;
      const [bidPdaKey] = bidPda(task, agent);

      setSubmitting(true);
      try {
        return await prog.methods
          .assignAgent()
          .accounts({
            task,
            bid: bidPdaKey,
            poster,
          } as any)
          .rpc();
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  const submitWork = useCallback(
    async (task: PublicKey, resultHash: Uint8Array, resultUri: string) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      if (resultHash.length !== 32) throw new Error("hash must be 32 bytes");
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const agent = wallet.publicKey;

      setSubmitting(true);
      try {
        return await prog.methods
          .submitWork(Array.from(resultHash), resultUri)
          .accounts({
            task,
            agent,
          } as any)
          .rpc();
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  const approve = useCallback(
    async (taskAccount: ForgeTask) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const poster = wallet.publicKey;
      const escrowAta = getAssociatedTokenAddressSync(
        RLO_MINT_PK,
        taskAccount.pubkey,
        true
      );
      const agentAta = getAssociatedTokenAddressSync(RLO_MINT_PK, taskAccount.agent);

      setSubmitting(true);
      try {
        return await prog.methods
          .approveWork()
          .accounts({
            task: taskAccount.pubkey,
            escrowTokenAccount: escrowAta,
            payoutTokenAccount: agentAta,
            poster,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .rpc();
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  const reject = useCallback(
    async (taskAccount: ForgeTask) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = forgeProgram(provider);
      const poster = wallet.publicKey;
      const escrowAta = getAssociatedTokenAddressSync(
        RLO_MINT_PK,
        taskAccount.pubkey,
        true
      );
      const posterAta = getAssociatedTokenAddressSync(RLO_MINT_PK, poster);

      setSubmitting(true);
      try {
        return await prog.methods
          .rejectWork()
          .accounts({
            task: taskAccount.pubkey,
            escrowTokenAccount: escrowAta,
            payoutTokenAccount: posterAta,
            poster,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .rpc();
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection]
  );

  /** Fetch the list of bids for a particular task. */
  const fetchBids = useCallback(
    async (task: PublicKey) => {
      if (!wallet.publicKey) return [];
      try {
        const provider = buildProvider(connection, wallet as any);
        const prog = forgeProgram(provider);
        const filter = [
          { memcmp: { offset: 8, bytes: task.toBase58() } },
        ];
        const rows = await (prog.account as any).bid.all(filter);
        return rows.map((r: any) => ({
          pubkey: r.publicKey,
          agent: r.account.agent as PublicKey,
          timestamp: Number(r.account.timestamp.toString()),
        }));
      } catch (e) {
        console.error("fetchBids failed", e);
        return [];
      }
    },
    [wallet, connection]
  );

  return {
    tasks,
    loading,
    submitting,
    postTask,
    bid,
    assign,
    submitWork,
    approve,
    reject,
    fetchBids,
    refresh: () => setTick((t) => t + 1),
  };
}
