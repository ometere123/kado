"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Star, Loader2, ArrowDownToLine, ArrowUpFromLine, HandCoins, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { useVault } from "@/hooks/use-vault";
import { useRloBalance } from "@/hooks/use-rlo-balance";
import { formatRlo, parseRloToRaw, txLink, cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/ui/confirm-modal";

// Mirror of the on-chain `match vault.credit_rating` in programs/vault/src/lib.rs.
// Tier 1 = 40% LTV, 2 = 50%, 3 = 60%, 4 = 70%, 5 = 80%.
export function tierMaxLtvBps(tier: number): number {
  return [0, 4000, 5000, 6000, 7000, 8000][tier] ?? 0;
}
export function tierMaxLtvPct(tier: number): number {
  return tierMaxLtvBps(tier) / 100;
}

export function VaultPanel() {
  const wallet = useWallet();
  const {
    state,
    submitting,
    remainingBorrow,
    ltvPct,
    initialize,
    stake,
    borrow,
    repay,
    withdraw,
  } = useVault();
  const { balance: rloBalance, refresh: refreshBalance } = useRloBalance();

  if (!wallet.connected) {
    return (
      <EmptyState
        title="Position"
        body="Connect a wallet to open a vault."
      />
    );
  }

  if (!state.exists) {
    return <InitializeVaultCard onInit={initialize} submitting={submitting} />;
  }

  const healthBg =
    ltvPct < 50
      ? "bg-emerald-500"
      : ltvPct < 80
      ? "bg-amber-500"
      : "bg-rose-500";

  const maxLtvBps = tierMaxLtvBps(state.creditRating);
  const healthFactor =
    state.borrowedAmount === 0n
      ? null
      : Number((state.stakedAmount * BigInt(maxLtvBps)) / (state.borrowedAmount * 10000n));

  return (
    <div className="grid gap-4">
      <Card>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <CardTitle>Position</CardTitle>
            <CardDescription>
              Borrow against your stake. Stay above the haircut.
            </CardDescription>
          </div>
          <Stars n={state.creditRating} />
        </div>

        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Staked" value={formatRlo(state.stakedAmount)} unit="$RLO" />
          <Stat label="Borrowed" value={formatRlo(state.borrowedAmount)} unit="$RLO" />
          <Stat label="Available" value={formatRlo(remainingBorrow)} unit="$RLO" />
          <Stat label="Max LTV" value={`${tierMaxLtvPct(state.creditRating).toFixed(0)}%`} />
        </div>

        <div className="mt-6">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-ink-muted">LTV</span>
            <span className="text-sm font-medium text-ink">
              {ltvPct.toFixed(1)}%{" "}
              <span className="text-ink-muted">/ {tierMaxLtvPct(state.creditRating).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg">
            <div
              className={`h-full ${healthBg} transition-all`}
              style={{ width: `${Math.min(100, ltvPct)}%` }}
            />
          </div>
          <HealthFactorRow healthFactor={healthFactor} />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ActionCard
          icon={<ArrowDownToLine className="h-4 w-4" />}
          title="Stake"
          hint={`In wallet · ${rloBalance != null ? formatRlo(rloBalance) : "—"} $RLO`}
          actionLabel="Stake"
          variant="primary"
          submitting={submitting}
          onSubmit={async (raw) => {
            const sig = await stake(raw);
            refreshBalance();
            return sig;
          }}
        />
        <ActionCard
          icon={<HandCoins className="h-4 w-4" />}
          title="Borrow"
          hint={`Available · ${formatRlo(remainingBorrow)} $RLO`}
          actionLabel="Borrow"
          variant="accent"
          submitting={submitting}
          onSubmit={async (raw) => {
            const sig = await borrow(raw);
            refreshBalance();
            return sig;
          }}
        />
        <ActionCard
          icon={<Wallet className="h-4 w-4" />}
          title="Repay"
          hint={`Outstanding · ${formatRlo(state.borrowedAmount)} $RLO`}
          actionLabel="Repay"
          variant="secondary"
          submitting={submitting}
          confirm={{ title: "Confirm repayment", description: "Repaying" }}
          onSubmit={async (raw) => {
            const sig = await repay(raw);
            refreshBalance();
            return sig;
          }}
        />
        <ActionCard
          icon={<ArrowUpFromLine className="h-4 w-4" />}
          title="Withdraw"
          hint={`Staked · ${formatRlo(state.stakedAmount)} $RLO`}
          actionLabel="Withdraw"
          variant="secondary"
          submitting={submitting}
          confirm={{ title: "Withdraw collateral?", description: "Withdrawing too much while borrowed may breach your LTV limit. Withdrawing" }}
          onSubmit={async (raw) => {
            const sig = await withdraw(raw);
            refreshBalance();
            return sig;
          }}
        />
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function HealthFactorRow({ healthFactor }: { healthFactor: number | null }) {
  if (healthFactor === null) {
    return (
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-ink-muted">Health factor</span>
        <span className="text-sm text-ink-muted">—</span>
      </div>
    );
  }
  const { color, barColor, label } =
    healthFactor > 2
      ? { color: "text-emerald-700", barColor: "bg-emerald-500", label: "Healthy" }
      : healthFactor >= 1.5
      ? { color: "text-amber-700", barColor: "bg-amber-500", label: "Monitor" }
      : healthFactor >= 1.1
      ? { color: "text-orange-700", barColor: "bg-orange-500", label: "At risk" }
      : { color: "text-rose-700", barColor: "bg-rose-600", label: "Danger — repay now" };
  const fillPct = Math.min(100, (healthFactor / 3) * 100);
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-ink-muted">Health factor</span>
        <span className={cn("text-sm font-semibold", color)}>
          {healthFactor.toFixed(2)}x · {label}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-bg">
        <div className={cn("h-full transition-all", barColor)} style={{ width: `${fillPct}%` }} />
      </div>
    </div>
  );
}

function InitializeVaultCard({
  onInit,
  submitting,
}: {
  onInit: (creditRating: number, haircutBps: number) => Promise<string>;
  submitting: boolean;
}) {
  const [rating, setRating] = useState(3);
  const [busy, setBusy] = useState(false);

  const maxLtvBps = tierMaxLtvBps(rating);
  const maxLtvPct = tierMaxLtvPct(rating);

  async function go() {
    setBusy(true);
    try {
      // Pass the tier-derived LTV as haircut_bps so the on-chain state stays in
      // sync with the tier (the program also re-derives from rating).
      const sig = await onInit(rating, maxLtvBps);
      toast.success("Vault opened", {
        description: "Stake $RLO to start borrowing.",
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
    } catch (e: any) {
      toast.error("Couldn't open vault", { description: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your vault</CardTitle>
        <CardDescription>
          Pick a tier. Higher tier = more capital efficiency — you can borrow more
          against the same collateral.
        </CardDescription>
      </CardHeader>

      <div>
        <label className="mb-3 block text-xs uppercase tracking-wide text-ink-muted">
          Credit tier
        </label>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className="rounded-md p-1 transition hover:bg-bg"
                aria-label={`Set tier ${n}`}
              >
                <Star
                  className={
                    n <= rating
                      ? "h-6 w-6 fill-cta text-cta"
                      : "h-6 w-6 text-ink/25"
                  }
                />
              </button>
            ))}
          </div>
          <div className="ml-2 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm">
            <span className="text-ink-muted">Borrows up to </span>
            <span className="font-semibold text-ink">{maxLtvPct.toFixed(0)}%</span>
            <span className="text-ink-muted"> of stake</span>
          </div>
        </div>
      </div>

      <Button
        className="mt-6"
        onClick={go}
        disabled={busy || submitting}
        variant="primary"
        size="lg"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Open vault
      </Button>
    </Card>
  );
}

function ActionCard({
  icon,
  title,
  hint,
  actionLabel,
  variant,
  submitting,
  onSubmit,
  confirm,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  actionLabel: string;
  variant: "primary" | "accent" | "secondary";
  submitting: boolean;
  onSubmit: (raw: bigint) => Promise<string>;
  confirm?: { title: string; description: string };
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRaw, setPendingRaw] = useState<bigint | null>(null);

  async function execute(raw: bigint) {
    setBusy(true);
    try {
      const sig = await onSubmit(raw);
      toast.success(`${actionLabel} · ${value} $RLO`, {
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setValue("");
    } catch (e: any) {
      toast.error(`${actionLabel} failed`, {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    let raw: bigint;
    try {
      raw = parseRloToRaw(value);
      if (raw <= 0n) throw new Error("Amount must be > 0");
    } catch (e: any) {
      toast.error("Invalid amount", { description: e?.message });
      return;
    }
    if (confirm) {
      setPendingRaw(raw);
    } else {
      await execute(raw);
    }
  }

  return (
    <>
      <Card>
        <div className="mb-3 flex items-center gap-2 text-ink-muted">
          {icon}
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span className="ml-auto text-xs">{hint}</span>
        </div>
        <div className="flex gap-2">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            onClick={go}
            disabled={busy || submitting || !value}
            variant={variant}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {actionLabel}
          </Button>
        </div>
      </Card>
      {confirm && (
        <ConfirmModal
          isOpen={pendingRaw !== null}
          title={confirm.title}
          description={confirm.description + " " + value + " ."}
          confirmLabel={actionLabel}
          destructive
          onConfirm={() => { if (pendingRaw !== null) execute(pendingRaw); }}
          onCancel={() => setPendingRaw(null)}
        />
      )}
    </>
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
        <span className="text-xl font-semibold tracking-tight text-ink tabular-nums">
          {value}
        </span>
        {unit && <span className="text-xs text-ink-muted">{unit}</span>}
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="brand">Tier {n}</Badge>
      <div className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={
              i <= n ? "h-4 w-4 fill-cta text-cta" : "h-4 w-4 text-ink/25"
            }
          />
        ))}
      </div>
      <span className="text-xs font-medium text-ink-muted">
        {tierMaxLtvPct(n).toFixed(0)}% max LTV
      </span>
    </div>
  );
}

function extractAnchorError(e: any): string | undefined {
  const msg = String(e?.message ?? e ?? "");
  const match = msg.match(/(?:Error Code:\s*|Error:\s*)([A-Z][A-Za-z]+)/);
  return match?.[1];
}
