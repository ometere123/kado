import { VaultPanel } from "@/components/vault-panel";

export const metadata = { title: "Vault — Kado" };

export default function VaultPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Vault</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Stake $RLO as collateral and borrow against it.
        </p>
      </div>
      <VaultPanel />
    </div>
  );
}
