import { LockboxPanel } from "@/components/lockbox-panel";

export const metadata = { title: "Safe Send — Kado" };

export default function LockboxPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Safe Send</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Lock $RLO until the recipient claims it. Auto-refunds after expiry.
        </p>
      </div>
      <LockboxPanel />
    </div>
  );
}
