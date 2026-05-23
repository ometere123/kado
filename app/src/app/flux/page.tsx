import { FluxPanel } from "@/components/flux-panel";

export const metadata = { title: "Flux AMM — Kado" };

export default function FluxPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Flux AMM</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Swap $RLO ↔ $USDC, add or remove liquidity from the pool.
        </p>
      </div>
      <FluxPanel />
    </div>
  );
}
