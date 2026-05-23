"use client";

import { useMemo, useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, ArrowDown, Plus, Minus } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { useFlux } from "@/hooks/use-flux";
import { useRloBalance } from "@/hooks/use-rlo-balance";
import { formatRlo, parseRloToRaw, txLink, cn } from "@/lib/utils";

const SLIPPAGE_BPS = 50; // 0.5%

type Tab = "swap" | "add" | "remove";

export function FluxPanel() {
  const wallet = useWallet();
  const flux = useFlux();
  const { refresh: refreshBalance } = useRloBalance();
  const [tab, setTab] = useState<Tab>("swap");

  if (!wallet.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swap</CardTitle>
          <CardDescription>Connect a wallet to trade or LP $RLO / $USDC.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Flux AMM</CardTitle>
          <CardDescription>
            $RLO ↔ $USDC · constant product · 0.30% fee
          </CardDescription>
        </div>
        <Badge variant="muted">
          {flux.pool.exists
            ? `${formatShort(rloReserve(flux.pool))} $RLO / ${formatShort(usdcReserve(flux.pool))} $USDC`
            : "loading"}
        </Badge>
      </div>

      <Tabs tab={tab} setTab={setTab} />

      <div className="mt-5">
        {tab === "swap" && <SwapTab flux={flux} refreshBalance={refreshBalance} />}
        {tab === "add" && <AddTab flux={flux} refreshBalance={refreshBalance} />}
        {tab === "remove" && <RemoveTab flux={flux} refreshBalance={refreshBalance} />}
      </div>
    </Card>
  );
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "swap", label: "Swap" },
    { id: "add", label: "Add liquidity" },
    { id: "remove", label: "Remove liquidity" },
  ];
  return (
    <div className="inline-flex gap-1 rounded-lg border border-line bg-bg p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition",
            tab === t.id
              ? "bg-brand text-white"
              : "text-ink-muted hover:text-ink"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Swap ----------

function SwapTab({
  flux,
  refreshBalance,
}: {
  flux: ReturnType<typeof useFlux>;
  refreshBalance: () => void;
}) {
  const [amountIn, setAmountIn] = useState("");
  const [rloIn, setRloIn] = useState(true);

  const rawIn = useMemo(() => {
    try {
      return parseRloToRaw(amountIn || "0");
    } catch {
      return 0n;
    }
  }, [amountIn]);
  const rawOut = useMemo(() => flux.quote(rawIn, rloIn), [flux, rawIn, rloIn]);
  const impact = useMemo(
    () => flux.priceImpactPct(rawIn, rloIn),
    [flux, rawIn, rloIn]
  );
  const minOut = (rawOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
  const inLabel = rloIn ? "$RLO" : "$USDC";
  const outLabel = rloIn ? "$USDC" : "$RLO";

  async function onSwap() {
    if (rawIn <= 0n) {
      toast.error("Enter an amount");
      return;
    }
    try {
      const sig = await flux.swap(rawIn, minOut, rloIn);
      toast.success(`${amountIn} ${inLabel} → ${formatRlo(rawOut)} ${outLabel}`, {
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setAmountIn("");
      refreshBalance();
    } catch (e: any) {
      toast.error("Swap failed", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  return (
    <div className="grid gap-2">
      <TokenInput
        label="You pay"
        token={inLabel}
        value={amountIn}
        onChange={setAmountIn}
      />

      <div className="-my-1 flex justify-center">
        <button
          type="button"
          onClick={() => setRloIn((v) => !v)}
          className="rounded-full border border-line bg-surface p-1.5 transition hover:border-brand hover:text-brand"
          aria-label="Flip swap direction"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="mb-1 flex justify-between text-xs text-ink-muted">
          <span>You receive</span>
          <span>{outLabel}</span>
        </div>
        <div className="text-xl font-semibold tracking-tight text-ink tabular-nums">
          {rawIn > 0n ? formatRlo(rawOut) : "0.00"}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <Meta
          label="Rate"
          value={
            rawIn > 0n
              ? `1 ${inLabel} ≈ ${(Number(rawOut) / Number(rawIn)).toFixed(4)} ${outLabel}`
              : "—"
          }
        />
        <Meta label="Min received" value={`${formatRlo(minOut)} ${outLabel}`} />
      </div>

      {rawIn > 0n && <ImpactRow impact={impact} />}

      <Button
        variant="accent"
        size="lg"
        className="mt-3"
        onClick={onSwap}
        disabled={flux.submitting || !amountIn || rawIn <= 0n || impact > 15}
      >
        {flux.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {impact > 15
          ? "Price impact too high"
          : rawIn <= 0n
          ? "Enter an amount"
          : "Swap"}
      </Button>
    </div>
  );
}

// ---------- Add Liquidity ----------

function AddTab({
  flux,
  refreshBalance,
}: {
  flux: ReturnType<typeof useFlux>;
  refreshBalance: () => void;
}) {
  // Always denominate input in $RLO; auto-derive $USDC from current ratio.
  const [rloInput, setRloInput] = useState("");
  const rawRlo = useMemo(() => {
    try {
      return parseRloToRaw(rloInput || "0");
    } catch {
      return 0n;
    }
  }, [rloInput]);

  const rawUsdc = useMemo(() => {
    // Map RLO → A or B depending on canonical ordering.
    if (!flux.pool.exists || flux.pool.lpSupply === 0n) return 0n;
    if (flux.pool.aIsRlo) {
      return flux.pairedAmountB(rawRlo);
    }
    return flux.pairedAmountA(rawRlo);
  }, [flux, rawRlo]);

  // Compute amountA / amountB in canonical (A, B) order.
  const [amountA, amountB] = flux.pool.aIsRlo
    ? [rawRlo, rawUsdc]
    : [rawUsdc, rawRlo];
  const expectedLp = useMemo(
    () => flux.quoteLpMint(amountA, amountB),
    [flux, amountA, amountB]
  );

  const shareAfter = useMemo(() => {
    const newSupply = flux.pool.lpSupply + expectedLp;
    if (newSupply === 0n) return 0;
    return Number((expectedLp * 10000n) / newSupply) / 100;
  }, [flux.pool.lpSupply, expectedLp]);

  async function go() {
    if (rawRlo <= 0n || rawUsdc <= 0n) {
      toast.error("Enter a deposit amount");
      return;
    }
    try {
      const sig = await flux.addLiquidity(amountA, amountB);
      toast.success(`+${formatRlo(expectedLp)} LP shares`, {
        description: `Deposited ${formatRlo(rawRlo)} $RLO + ${formatRlo(rawUsdc)} $USDC.`,
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setRloInput("");
      refreshBalance();
    } catch (e: any) {
      toast.error("Add liquidity failed", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  return (
    <div className="grid gap-2">
      <TokenInput
        label="Deposit"
        token="$RLO"
        value={rloInput}
        onChange={setRloInput}
      />
      <div className="-my-1 flex justify-center">
        <div className="rounded-full border border-line bg-surface p-1.5 text-ink-muted">
          <Plus className="h-4 w-4" />
        </div>
      </div>
      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="mb-1 flex justify-between text-xs text-ink-muted">
          <span>Paired</span>
          <span>$USDC</span>
        </div>
        <div className="text-xl font-semibold tracking-tight text-ink tabular-nums">
          {rawRlo > 0n ? formatRlo(rawUsdc) : "0.00"}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <Meta label="LP received" value={rawRlo > 0n ? formatRlo(expectedLp) : "—"} />
        <Meta
          label="Pool share"
          value={rawRlo > 0n ? `${shareAfter.toFixed(2)}%` : "—"}
        />
      </div>

      <Button
        variant="primary"
        size="lg"
        className="mt-3"
        onClick={go}
        disabled={flux.submitting || rawRlo <= 0n}
      >
        {flux.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {rawRlo <= 0n ? "Enter an amount" : "Add liquidity"}
      </Button>
    </div>
  );
}

// ---------- Remove Liquidity ----------

function RemoveTab({
  flux,
  refreshBalance,
}: {
  flux: ReturnType<typeof useFlux>;
  refreshBalance: () => void;
}) {
  const [lpInput, setLpInput] = useState("");
  const rawLp = useMemo(() => {
    try {
      return parseRloToRaw(lpInput || "0");
    } catch {
      return 0n;
    }
  }, [lpInput]);

  const { a, b } = useMemo(() => flux.quoteWithdraw(rawLp), [flux, rawLp]);
  const rloOut = flux.pool.aIsRlo ? a : b;
  const usdcOut = flux.pool.aIsRlo ? b : a;

  async function go() {
    if (rawLp <= 0n) {
      toast.error("Enter LP amount");
      return;
    }
    if (rawLp > flux.lpBalance) {
      toast.error("Not enough LP shares");
      return;
    }
    try {
      const sig = await flux.removeLiquidity(rawLp);
      toast.success(
        `${formatRlo(rloOut)} $RLO + ${formatRlo(usdcOut)} $USDC returned`,
        {
          action: { label: "View", onClick: () => window.open(txLink(sig)) },
        }
      );
      setLpInput("");
      refreshBalance();
    } catch (e: any) {
      toast.error("Remove liquidity failed", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
          <span>Burn</span>
          <span className="inline-flex items-center gap-2">
            <span>LP balance:</span>
            <button
              type="button"
              className="font-medium text-brand hover:underline tabular-nums"
              onClick={() => setLpInput(formatRloPlain(flux.lpBalance))}
              disabled={flux.lpBalance === 0n}
            >
              {formatRlo(flux.lpBalance)}
            </button>
          </span>
        </div>
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={lpInput}
          onChange={(e) => setLpInput(e.target.value)}
          className="border-0 bg-transparent px-0 text-xl font-semibold tracking-tight focus-visible:ring-0"
        />
      </div>

      <div className="-my-1 flex justify-center">
        <div className="rounded-full border border-line bg-surface p-1.5 text-ink-muted">
          <ArrowDown className="h-4 w-4" />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <ReceiveRow label="$RLO" value={rloOut} />
        <ReceiveRow label="$USDC" value={usdcOut} />
      </div>

      <Button
        variant="primary"
        size="lg"
        className="mt-3"
        onClick={go}
        disabled={
          flux.submitting ||
          rawLp <= 0n ||
          rawLp > flux.lpBalance ||
          flux.lpBalance === 0n
        }
      >
        {flux.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {flux.lpBalance === 0n
          ? "No LP shares"
          : rawLp <= 0n
          ? "Enter an amount"
          : rawLp > flux.lpBalance
          ? "Exceeds LP balance"
          : "Remove liquidity"}
      </Button>
    </div>
  );
}


// ---------- Impact badge ----------

function ImpactRow({ impact }: { impact: number }) {
  if (impact < 1) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          Low impact · {impact.toFixed(2)}%
        </span>
      </div>
    );
  }
  if (impact <= 5) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          Medium impact · {impact.toFixed(2)}%
        </span>
      </div>
    );
  }
  if (impact <= 15) {
    return (
      <div className="mt-2 grid gap-1">
        <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
          High impact ⚠ · {impact.toFixed(2)}%
        </span>
        <p className="text-xs text-rose-600">This swap moves the price significantly.</p>
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-1">
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-800">
        Price impact too high · {impact.toFixed(2)}%
      </span>
      <p className="text-xs font-medium text-rose-700">Reduce your swap amount.</p>
    </div>
  );
}

function ReceiveRow({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <div className="mb-1 text-xs text-ink-muted">You receive · {label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">
        {value > 0n ? formatRlo(value) : "0.00"}
      </div>
    </div>
  );
}

// ---------- shared bits ----------

function TokenInput({
  label,
  token,
  value,
  onChange,
}: {
  label: string;
  token: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <div className="mb-1 flex justify-between text-xs text-ink-muted">
        <span>{label}</span>
        <span>{token}</span>
      </div>
      <Input
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-0 bg-transparent px-0 text-xl font-semibold tracking-tight focus-visible:ring-0"
      />
    </div>
  );
}

function Meta({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div
        className={`mt-0.5 font-medium ${
          highlight ? "text-cta" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function rloReserve(pool: { aIsRlo: boolean; reserveA: bigint; reserveB: bigint }) {
  return pool.aIsRlo ? pool.reserveA : pool.reserveB;
}
function usdcReserve(pool: { aIsRlo: boolean; reserveA: bigint; reserveB: bigint }) {
  return pool.aIsRlo ? pool.reserveB : pool.reserveA;
}

function formatShort(raw: bigint): string {
  const whole = Number(raw) / 1e6;
  if (whole >= 1e6) return `${(whole / 1e6).toFixed(2)}M`;
  if (whole >= 1e3) return `${(whole / 1e3).toFixed(1)}k`;
  return whole.toFixed(0);
}

/** formatRlo without the comma — for re-injection into Input.value. */
function formatRloPlain(raw: bigint): string {
  const divisor = 10n ** 6n;
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function extractAnchorError(e: any): string | undefined {
  const msg = String(e?.message ?? e ?? "");
  const match = msg.match(/(?:Error Code:\s*|Error:\s*)([A-Z][A-Za-z]+)/);
  return match?.[1];
}
