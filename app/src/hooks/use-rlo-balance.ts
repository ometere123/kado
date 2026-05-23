"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { RLO_MINT_PK } from "@/lib/anchor";

/**
 * Returns the connected wallet's $RLO balance (in base units).
 * Polls every 10s; refetch immediately by calling the returned `refresh()`.
 */
export function useRloBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const ata = getAssociatedTokenAddressSync(RLO_MINT_PK, publicKey!);
        const acc = await getAccount(connection, ata);
        if (!cancelled) setBalance(acc.amount);
      } catch {
        if (!cancelled) setBalance(0n);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey, connection, tick]);

  return { balance, loading, refresh: () => setTick((t) => t + 1) };
}
