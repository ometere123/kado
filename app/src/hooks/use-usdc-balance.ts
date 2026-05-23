"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { USDC_MINT_PK } from "@/lib/anchor";

/** Connected wallet's $USDC balance (base units). Mirrors useRloBalance. */
export function useUsdcBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const ata = getAssociatedTokenAddressSync(USDC_MINT_PK, publicKey!);
        const acc = await getAccount(connection, ata);
        if (!cancelled) setBalance(acc.amount);
      } catch {
        if (!cancelled) setBalance(0n);
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey, connection, tick]);

  return { balance, refresh: () => setTick((t) => t + 1) };
}
