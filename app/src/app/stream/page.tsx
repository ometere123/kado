import { StreamlinePanel } from "@/components/streamline-panel";

export const metadata = { title: "Auto-pay — Kado" };

export default function StreamPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Auto-pay</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Lock a payment schedule once — payments fire automatically on cadence.
        </p>
      </div>
      <StreamlinePanel />
    </div>
  );
}
