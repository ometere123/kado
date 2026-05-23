import { GridPanel } from "@/components/grid-panel";

export const metadata = { title: "Grid — Kado" };

export default function GridPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Grid
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Post bounties. Get them done. Reward escrows until you approve.
        </p>
      </div>
      <GridPanel />
    </div>
  );
}
