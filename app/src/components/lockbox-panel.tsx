"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Loader2, Lock, Send, Copy, Check, Clock, Inbox } from "lucide-react";
import { toast } from "sonner";

import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  useLockbox,
  encodeClaimLink,
  decodeNonceFromInput,
  ActiveTransfer,
} from "@/hooks/use-lockbox";
import { useRloBalance } from "@/hooks/use-rlo-balance";
import { formatRlo, parseRloToRaw, txLink, short } from "@/lib/utils";
import { ConfirmModal } from "@/components/ui/confirm-modal";

const EXPIRIES = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 60 * 60 * 24 },
  { label: "7 days", seconds: 60 * 60 * 24 * 7 },
];

export function LockboxPanel() {
  const wallet = useWallet();
  const { sent, submitting, createTransfer, claimByNonce, refundTransfer } =
    useLockbox();
  const { refresh: refreshBalance } = useRloBalance();

  if (!wallet.connected) {
    return (
      <Card>
        <CardTitle>Safe Send</CardTitle>
        <CardDescription>
          Connect a wallet to send $RLO with an expiry-protected claim link.
        </CardDescription>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-5">
        <CardTitle>Safe Send</CardTitle>
        <CardDescription>
          Lock $RLO until the recipient claims it. Auto-refunds to you after
          the expiry if they don't.
        </CardDescription>
      </div>

      <div className="grid gap-6">
        <SendForm
          submitting={submitting}
          onCreate={async (recipient, amount, expirySeconds) => {
            const res = await createTransfer(recipient, amount, expirySeconds);
            refreshBalance();
            return res;
          }}
        />

        <SentList
          sent={sent}
          submitting={submitting}
          onRefund={async (t) => {
            const sig = await refundTransfer(t);
            refreshBalance();
            return sig;
          }}
        />

        <ClaimForm
          submitting={submitting}
          onClaim={async (nonce) => {
            const res = await claimByNonce(nonce);
            refreshBalance();
            return res;
          }}
        />
      </div>
    </Card>
  );
}

// ---------- Send form ----------

function SendForm({
  submitting,
  onCreate,
}: {
  submitting: boolean;
  onCreate: (
    recipient: PublicKey,
    amount: bigint,
    expirySeconds: number
  ) => Promise<{ sig: string; nonce: Uint8Array; transfer: PublicKey }>;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(1); // default 24h
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  async function go() {
    let recipientPk: PublicKey;
    try {
      recipientPk = new PublicKey(recipient.trim());
    } catch {
      toast.error("Invalid recipient address");
      return;
    }
    let raw: bigint;
    try {
      raw = parseRloToRaw(amount);
      if (raw <= 0n) throw new Error("Amount must be > 0");
    } catch (e: any) {
      toast.error("Invalid amount", { description: e?.message });
      return;
    }
    setBusy(true);
    try {
      const { sig, nonce } = await onCreate(
        recipientPk,
        raw,
        EXPIRIES[expiryIdx].seconds
      );
      const link = encodeClaimLink(nonce);
      setLastLink(link);
      toast.success("Transfer locked", {
        description: `${formatRlo(raw)} $RLO held until claim or expiry.`,
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setAmount("");
      setRecipient("");
    } catch (e: any) {
      toast.error("Couldn't send", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Send className="h-4 w-4 text-brand" />
        Send safely
      </div>
      <div className="grid gap-3">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
            Recipient
          </label>
          <Input
            placeholder="Solana wallet address"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="grid items-end gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
              Amount · $RLO
            </label>
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
              Expiry
            </label>
            <select
              value={expiryIdx}
              onChange={(e) => setExpiryIdx(Number(e.target.value))}
              className="flex h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {EXPIRIES.map((e, i) => (
                <option key={e.seconds} value={i}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Button
              variant="primary"
              size="lg"
              onClick={go}
              disabled={busy || submitting}
              className="w-full"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Send safely
            </Button>
          </div>
        </div>

        {lastLink ? <ClaimLinkBanner link={lastLink} onDismiss={() => setLastLink(null)} /> : null}
      </div>
    </div>
  );
}

function ClaimLinkBanner({
  link,
  onDismiss,
}: {
  link: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <div className="rounded-lg border border-brand bg-brand-wash p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-brand">
          Share this claim link
        </div>
        <button
          onClick={onDismiss}
          className="text-xs text-ink-muted hover:text-ink"
        >
          Dismiss
        </button>
      </div>
      <div className="flex gap-2">
        <code className="flex-1 truncate rounded-md bg-bg px-2.5 py-2 font-mono text-xs text-ink">
          {link}
        </code>
        <Button variant="primary" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

// ---------- Sent list ----------

function SentList({
  sent,
  submitting,
  onRefund,
}: {
  sent: ActiveTransfer[];
  submitting: boolean;
  onRefund: (t: ActiveTransfer) => Promise<string>;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Clock className="h-4 w-4 text-brand" />
        Outgoing
      </div>
      {sent.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-bg py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash">
            <Lock className="h-6 w-6 text-brand" />
          </div>
          <div>
            <p className="font-semibold text-ink">No pending transfers</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              Send tokens safely — they auto-refund if unclaimed.
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-2">
          {sent.map((t) => {
            const expired = now >= t.expiry;
            const eta = Math.max(0, t.expiry - now);
            return (
              <li
                key={t.pubkey.toBase58()}
                className="flex items-center justify-between rounded-lg border border-line bg-bg p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={t.claimed ? "success" : expired ? "warn" : "brand"}>
                      {t.claimed ? "Claimed" : expired ? "Expired" : "Pending"}
                    </Badge>
                    <span className="font-mono text-xs text-ink-muted">
                      → {short(t.recipient.toBase58(), 4, 4)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3 text-sm">
                    <span className="font-semibold tabular-nums text-ink">
                      {formatRlo(t.amount)} $RLO
                    </span>
                    <span className="text-xs text-ink-muted">
                      {t.claimed
                        ? "delivered"
                        : expired
                        ? "ready to refund"
                        : `expires in ${formatEta(eta)}`}
                    </span>
                  </div>
                </div>
                {!t.claimed && expired ? (
                  <RefundWithConfirm
                    submitting={submitting}
                    transfer={t}
                    onRefund={onRefund}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RefundWithConfirm({
  submitting,
  transfer,
  onRefund,
}: {
  submitting: boolean;
  transfer: ActiveTransfer;
  onRefund: (t: ActiveTransfer) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" disabled={submitting} onClick={() => setOpen(true)}>
        Refund
      </Button>
      <ConfirmModal
        isOpen={open}
        title="Refund this transfer?"
        description="The recipient will no longer be able to claim. Funds return to your wallet."
        confirmLabel="Refund"
        destructive
        onConfirm={async () => {
          try {
            const sig = await onRefund(transfer);
            toast.success("Refunded", {
              action: { label: "View", onClick: () => window.open(txLink(sig)) },
            });
          } catch (e: any) {
            toast.error("Refund failed", {
              description: extractAnchorError(e) ?? String(e?.message ?? e),
            });
          }
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

// ---------- Claim form ----------

function ClaimForm({
  submitting,
  onClaim,
}: {
  submitting: boolean;
  onClaim: (nonce: Uint8Array) => Promise<{ sig: string; amount: bigint }>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    const nonce = decodeNonceFromInput(input);
    if (!nonce) {
      toast.error("Paste a valid claim link");
      return;
    }
    setBusy(true);
    try {
      const { sig, amount } = await onClaim(nonce);
      toast.success("Claimed", {
        description: `${formatRlo(amount)} $RLO landed in your wallet.`,
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setInput("");
    } catch (e: any) {
      toast.error("Couldn't claim", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Inbox className="h-4 w-4 text-brand" />
        Have a claim link?
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="kado://claim/…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="font-mono text-sm"
        />
        <Button
          variant="accent"
          onClick={go}
          disabled={busy || submitting || !input}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Claim
        </Button>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function extractAnchorError(e: any): string | undefined {
  const msg = String(e?.message ?? e ?? "");
  const match = msg.match(/(?:Error Code:\s*|Error:\s*)([A-Z][A-Za-z]+)/);
  return match?.[1];
}
