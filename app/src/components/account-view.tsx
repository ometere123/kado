"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  Copy,
  Check,
  Droplet,
  Loader2,
  ExternalLink,
  Wallet as WalletIcon,
  ListChecks,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useRloBalance } from "@/hooks/use-rlo-balance";
import { useUsdcBalance } from "@/hooks/use-usdc-balance";
import { formatRlo, txLink, short } from "@/lib/utils";

export function AccountView() {
  const wallet = useWallet();

  if (!wallet.connected || !wallet.publicKey) {
    return (
      <Card>
        <CardTitle>Connect a wallet</CardTitle>
        <CardDescription>
          Use the wallet button in the header to get started.
        </CardDescription>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      <WalletCard />
      <div className="grid gap-6 md:grid-cols-2">
        <FaucetCard />
        <RecentTxCard />
      </div>
    </div>
  );
}

// ---------- Wallet card ----------

function WalletCard() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { balance: rlo } = useRloBalance();
  const { balance: usdc } = useUsdcBalance();
  const [sol, setSol] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    async function load() {
      try {
        const lamports = await connection.getBalance(publicKey!);
        if (!cancelled) setSol(lamports / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setSol(null);
      }
    }
    load();
    const id = setInterval(load, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey, connection]);

  async function copy() {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <WalletIcon className="h-4 w-4 text-brand" />
        <CardTitle>Wallet</CardTitle>
      </div>

      <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-line bg-bg p-3">
        <code className="truncate font-mono text-sm text-ink">
          {publicKey?.toBase58()}
        </code>
        <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Balance label="$RLO" value={rlo != null ? formatRlo(rlo) : "—"} />
        <Balance label="$USDC" value={usdc != null ? formatRlo(usdc) : "—"} />
        <Balance label="SOL" value={sol != null ? sol.toFixed(4) : "—"} />
      </div>
    </Card>
  );
}

function Balance({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

// ---------- Faucet card ----------

type FaucetStatus = {
  canClaim: boolean;
  cooldownLeftMs?: number;
  lastClaimedMs?: number;
  signature?: string;
};

function FaucetCard() {
  const { publicKey } = useWallet();
  const { refresh } = useRloBalance();
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  async function loadStatus() {
    if (!publicKey) return;
    try {
      const res = await fetch(
        `/api/faucet?wallet=${publicKey.toBase58()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error("faucet status failed", e);
    }
  }

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 30_000);
    return () => clearInterval(id);
  }, [publicKey]);

  async function claim() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Faucet error");
      toast.success(`+${data.amount} ${data.symbol}`, {
        action: { label: "View", onClick: () => window.open(txLink(data.signature)) },
      });
      refresh();
      loadStatus();
    } catch (e: any) {
      toast.error("Couldn't fund wallet", { description: e?.message });
      loadStatus();
    } finally {
      setBusy(false);
    }
  }

  // Recompute cooldown locally using `now` so the timer ticks down without
  // re-fetching from the server.
  const cooldownLeft =
    status?.lastClaimedMs != null
      ? Math.max(0, status.lastClaimedMs + 24 * 3600 * 1000 - now)
      : 0;
  const canClaim = !cooldownLeft;

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Droplet className="h-4 w-4 text-brand" />
        <CardTitle>$RLO faucet</CardTitle>
      </div>
      <CardDescription className="mb-4">
        1,000 $RLO per wallet, every 24 hours.
      </CardDescription>

      <Button
        variant="primary"
        size="lg"
        onClick={claim}
        disabled={busy || !canClaim}
        className="w-full"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Droplet className="h-4 w-4" />
        )}
        {canClaim ? "Request 1,000 $RLO" : `Next claim in ${formatEta(cooldownLeft)}`}
      </Button>

      {status?.lastClaimedMs && status?.signature ? (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-line bg-bg p-3 text-xs">
          <span className="text-ink-muted">
            Last claimed {formatRelativeTime(status.lastClaimedMs, now)}
          </span>
          <a
            href={txLink(status.signature)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark"
          >
            View tx <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}
    </Card>
  );
}

// ---------- Recent transactions ----------

type RecentTx = {
  signature: string;
  blockTime: number | null;
  err: any;
};

function RecentTxCard() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [txs, setTxs] = useState<RecentTx[] | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    async function load() {
      try {
        const sigs = await connection.getSignaturesForAddress(publicKey!, {
          limit: 5,
        });
        if (!cancelled) {
          setTxs(
            sigs.map((s) => ({
              signature: s.signature,
              blockTime: s.blockTime ?? null,
              err: s.err,
            }))
          );
        }
      } catch (e) {
        console.error("getSignaturesForAddress failed", e);
        if (!cancelled) setTxs([]);
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey, connection]);

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-brand" />
        <CardTitle>Recent activity</CardTitle>
      </div>
      {txs == null ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : txs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Inbox className="h-8 w-8 text-ink-muted/60" />
          <div className="text-sm text-ink-muted">No transactions yet.</div>
        </div>
      ) : (
        <ul className="grid gap-2">
          {txs.map((t) => (
            <li
              key={t.signature}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {t.err ? (
                    <Badge variant="danger">Failed</Badge>
                  ) : (
                    <Badge variant="success">Success</Badge>
                  )}
                  <span className="font-mono text-xs text-ink">
                    {short(t.signature, 6, 6)}
                  </span>
                </div>
                {t.blockTime ? (
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {new Date(t.blockTime * 1000).toLocaleString()}
                  </div>
                ) : null}
              </div>
              <a
                href={txLink(t.signature)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-dark"
              >
                View <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- helpers ----------

function formatEta(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.ceil(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.ceil(h / 24)}d`;
}

function formatRelativeTime(thenMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - thenMs);
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
