"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Loader2, X, Play, Calendar } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { useStreamline } from "@/hooks/use-streamline";
import { useRloBalance } from "@/hooks/use-rlo-balance";
import { formatRlo, parseRloToRaw, txLink, short } from "@/lib/utils";
import { ConfirmModal } from "@/components/ui/confirm-modal";

type Cadence = { label: string; seconds: number };
const CADENCES: Cadence[] = [
  { label: "Every minute", seconds: 60 },
  { label: "Every hour", seconds: 60 * 60 },
  { label: "Every day", seconds: 60 * 60 * 24 },
  { label: "Every week", seconds: 60 * 60 * 24 * 7 },
];

export function StreamlinePanel() {
  const wallet = useWallet();
  const [recipientInput, setRecipientInput] = useState("");
  const recipientPk = useMemo(() => {
    try {
      return recipientInput ? new PublicKey(recipientInput.trim()) : null;
    } catch {
      return null;
    }
  }, [recipientInput]);

  const {
    schedule,
    submitting,
    create,
    executeNow,
    cancel,
    nextPaymentAt,
    refresh: refreshSchedule,
  } = useStreamline(recipientPk);
  const { refresh: refreshBalance } = useRloBalance();

  const [amount, setAmount] = useState("");
  const [cadenceIdx, setCadenceIdx] = useState(0);
  const [totalPayments, setTotalPayments] = useState("5");

  if (!wallet.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Auto-pay</CardTitle>
          <CardDescription>Connect a wallet to schedule $RLO payments.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function onCreate() {
    if (!recipientPk) {
      toast.error("Enter a recipient address");
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
    const total = parseInt(totalPayments, 10);
    if (!total || total < 1 || total > 255) {
      toast.error("Total payments must be 1–255");
      return;
    }
    try {
      const sig = await create({
        amountPerPayment: raw,
        intervalSeconds: CADENCES[cadenceIdx].seconds,
        totalPayments: total,
      });
      toast.success("Schedule created", {
        description: `${formatRlo(raw)} $RLO ${CADENCES[cadenceIdx].label.toLowerCase()} × ${total}`,
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setAmount("");
      refreshBalance();
    } catch (e: any) {
      toast.error("Couldn't create schedule", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  async function onExecute() {
    try {
      const sig = await executeNow();
      toast.success("Payment sent", {
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      refreshBalance();
    } catch (e: any) {
      toast.error("Couldn't send payment", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  async function onCancel() {
    try {
      const sig = await cancel();
      toast.success("Schedule cancelled, escrow returned", {
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      refreshBalance();
    } catch (e: any) {
      toast.error("Cancel failed", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  return (
    <Card>
      <div className="mb-5">
        <CardTitle>Auto-pay</CardTitle>
        <CardDescription>
          Lock a schedule once. Payments fire on cadence — anyone can trigger them.
        </CardDescription>
      </div>

      <div className="mb-4">
        <label className="mb-2 block text-xs uppercase tracking-wide text-ink-muted">
          Recipient
        </label>
        <Input
          placeholder="Solana wallet address"
          value={recipientInput}
          onChange={(e) => setRecipientInput(e.target.value)}
          className="font-mono text-sm"
        />
        {recipientInput && !recipientPk ? (
          <div className="mt-1 text-xs text-rose-500">Invalid address</div>
        ) : null}
      </div>

      {recipientPk && schedule.exists ? (
        <ScheduleView
          schedule={schedule}
          nextPaymentAt={nextPaymentAt}
          submitting={submitting}
          onExecute={onExecute}
          onCancel={onCancel}
          onReset={onCancel}
          onRefresh={refreshSchedule}
          payer={wallet.publicKey?.toBase58() ?? ""}
          recipient={recipientPk.toBase58()}
        />
      ) : !recipientPk ? (
        <StreamlineEmptyState />
      ) : (
        <CreateForm
          amount={amount}
          setAmount={setAmount}
          cadenceIdx={cadenceIdx}
          setCadenceIdx={setCadenceIdx}
          totalPayments={totalPayments}
          setTotalPayments={setTotalPayments}
          submitting={submitting}
          disabled={!recipientPk}
          onCreate={onCreate}
        />
      )}
    </Card>
  );
}

function CreateForm(props: {
  amount: string;
  setAmount: (v: string) => void;
  cadenceIdx: number;
  setCadenceIdx: (i: number) => void;
  totalPayments: string;
  setTotalPayments: (v: string) => void;
  submitting: boolean;
  disabled: boolean;
  onCreate: () => Promise<void> | void;
}) {
  const totalRaw = (() => {
    try {
      return (
        parseRloToRaw(props.amount || "0") *
        BigInt(parseInt(props.totalPayments, 10) || 0)
      );
    } catch {
      return 0n;
    }
  })();

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-ink-muted">
            Amount
          </label>
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={props.amount}
            onChange={(e) => props.setAmount(e.target.value)}
          />
          <div className="mt-1 text-xs text-ink-muted">$RLO per payment</div>
        </div>
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-ink-muted">
            Cadence
          </label>
          <select
            value={props.cadenceIdx}
            onChange={(e) => props.setCadenceIdx(Number(e.target.value))}
            className="flex h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {CADENCES.map((c, i) => (
              <option key={c.seconds} value={i}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-ink-muted">
            Payments
          </label>
          <Input
            type="number"
            min={1}
            max={255}
            value={props.totalPayments}
            onChange={(e) => props.setTotalPayments(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-bg p-3 text-sm">
        <span className="text-ink-muted">Will lock </span>
        <span className="font-semibold text-ink tabular-nums">
          {formatRlo(totalRaw)} $RLO
        </span>
        <span className="text-ink-muted"> in escrow upfront.</span>
      </div>

      <Button
        variant="primary"
        size="lg"
        disabled={props.submitting || props.disabled}
        onClick={() => props.onCreate()}
      >
        {props.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Create schedule
      </Button>
    </div>
  );
}

function ScheduleView({
  schedule,
  nextPaymentAt,
  submitting,
  onExecute,
  onCancel,
  onReset,
  onRefresh,
  payer,
  recipient,
}: {
  schedule: any;
  nextPaymentAt: number | null;
  submitting: boolean;
  onExecute: () => Promise<void> | void;
  onCancel: () => Promise<void> | void;
  onReset: () => Promise<void> | void;
  onRefresh: () => void;
  payer: string;
  recipient: string;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);

  const remaining = schedule.totalPayments - schedule.paymentsMade;
  const cranable = nextPaymentAt != null && now >= nextPaymentAt;

  // Server-side auto-crank — polls every 2s when payment is due, retries on failure
  const cranking = useRef(false);
  useEffect(() => {
    if (remaining === 0) return;

    async function tryCrank() {
      if (cranking.current) return;
      const nowSec = Math.floor(Date.now() / 1000);
      if (nextPaymentAt == null || nowSec < nextPaymentAt) return;
      cranking.current = true;
      try {
        const res = await fetch("/api/crank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payer, recipient }),
        });
        const data = await res.json();
        if (data.ok) {
          // Wait briefly for RPC to settle before refreshing
          await new Promise((r) => setTimeout(r, 1500));
          onRefresh();
        }
      } catch (e) {
        console.error("crank error", e);
      } finally {
        cranking.current = false;
      }
    }

    // Poll every 2s — catches due payments even if cranable didn't flip cleanly
    const id = setInterval(tryCrank, 2_000);
    tryCrank(); // also fire immediately
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, nextPaymentAt, payer, recipient]);

  const eta =
    nextPaymentAt != null && nextPaymentAt > now ? nextPaymentAt - now : 0;

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Badge variant={remaining === 0 ? "success" : "brand"}>
          {remaining === 0 ? "Complete" : "Active"}
        </Badge>
        <span className="font-mono text-xs text-ink-muted">
          → {short(schedule.recipient?.toBase58() ?? "", 6, 6)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Per payment" value={formatRlo(schedule.amountPerPayment)} unit="$RLO" />
        <Stat
          label="Progress"
          value={`${schedule.paymentsMade}/${schedule.totalPayments}`}
        />
        <Stat label="In escrow" value={formatRlo(schedule.escrowBalance)} unit="$RLO" />
        <Stat
          label="Next"
          value={remaining === 0 ? "—" : cranable ? "now" : formatEta(eta)}
        />
      </div>

      {remaining > 0 ? (
        <div className="flex gap-2">
          <Button
            variant="accent"
            disabled={submitting || !cranable}
            onClick={() => onExecute()}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Send next payment
          </Button>
          <CancelWithConfirm submitting={submitting} onCancel={onCancel} />
        </div>
      ) : (
        <Button variant="outline" disabled={submitting} onClick={() => onReset()}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Start new schedule
        </Button>
      )}
    </div>
  );
}


function CancelWithConfirm({
  submitting,
  onCancel,
}: {
  submitting: boolean;
  onCancel: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" disabled={submitting} onClick={() => setOpen(true)}>
        <X className="h-4 w-4" />
        Cancel & refund
      </Button>
      <ConfirmModal
        isOpen={open}
        title="Cancel this schedule?"
        description="Remaining escrowed funds will be returned to your wallet."
        confirmLabel="Yes, cancel"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => onCancel()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function StreamlineEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-bg py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash">
        <Calendar className="h-6 w-6 text-brand" />
      </div>
      <div>
        <p className="font-semibold text-ink">No active schedule</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          Set up recurring payments and they run automatically.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums text-ink">{value}</span>
        {unit && <span className="text-xs text-ink-muted">{unit}</span>}
      </div>
    </div>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function extractAnchorError(e: any): string | undefined {
  const msg = String(e?.message ?? e ?? "");
  const match = msg.match(/(?:Error Code:\s*|Error:\s*)([A-Z][A-Za-z]+)/);
  return match?.[1];
}
