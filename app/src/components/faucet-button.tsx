"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Droplet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useRloBalance } from "@/hooks/use-rlo-balance";
import { txLink } from "@/lib/utils";

export function FaucetButton() {
  const { publicKey, connected } = useWallet();
  const { refresh } = useRloBalance();
  const [busy, setBusy] = useState(false);

  if (!connected || !publicKey) return null;

  async function claim() {
    setBusy(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey!.toBase58() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Faucet error");
      toast.success(`+${data.amount} ${data.symbol}`, {
        description: "Tokens sent to your wallet.",
        action: {
          label: "View",
          onClick: () => window.open(txLink(data.signature)),
        },
      });
      refresh();
    } catch (e: any) {
      toast.error("Couldn't fund wallet", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={claim}
      disabled={busy}
      aria-label="Get $RLO"
      title="Get 1,000 $RLO"
      className="h-8 px-2"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Droplet className="h-4 w-4" />
      )}
    </Button>
  );
}
