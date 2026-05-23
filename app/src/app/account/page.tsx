import { AccountView } from "@/components/account-view";

export const metadata = { title: "Account — Kado" };

export default function AccountPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Account
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your wallet, balances, and the last on-chain activity.
        </p>
      </div>
      <AccountView />
    </div>
  );
}
