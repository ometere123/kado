"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { LogoImage } from "@/components/logo-image";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useRloBalance } from "@/hooks/use-rlo-balance";
import { formatRlo, cn, getExplorer, setExplorer, Explorer } from "@/lib/utils";
import { FaucetButton } from "@/components/faucet-button";
import { ThemeToggle } from "@/components/theme-toggle";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export function Header() {
  const { balance } = useRloBalance();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
          </Link>
          <nav className="flex gap-1">
            <NavLink href="/vault"   active={pathname?.startsWith("/vault")}>Vault</NavLink>
            <NavLink href="/flux"    active={pathname?.startsWith("/flux")}>Flux</NavLink>
            <NavLink href="/stream"  active={pathname?.startsWith("/stream")}>Auto-pay</NavLink>
            <NavLink href="/lockbox" active={pathname?.startsWith("/lockbox")}>Lockbox</NavLink>
            <NavLink href="/grid"    active={pathname?.startsWith("/grid")}>Grid</NavLink>
            <NavLink href="/account" active={pathname?.startsWith("/account")}>Account</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="muted" className="hidden sm:inline-flex">Devnet</Badge>
          <ExplorerPicker />
          {balance != null ? (
            <div className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-sm font-medium text-ink sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {formatRlo(balance)}
              <span className="text-ink-muted">$RLO</span>
            </div>
          ) : null}
          <FaucetButton />
          <WalletMultiButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href, active, children,
}: {
  href: string; active?: boolean; children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition",
        active ? "bg-brand-wash text-brand" : "text-ink-muted hover:bg-surface hover:text-ink"
      )}
    >
      {children}
    </Link>
  );
}

function Logo() {
  return <LogoImage height={36} />;
}

const EXPLORERS: { value: Explorer; label: string }[] = [
  { value: "solana.fm",      label: "Solana FM" },
  { value: "solscan",        label: "Solscan" },
  { value: "solanaexplorer", label: "Explorer" },
];

function ExplorerPicker() {
  const [current, setCurrent] = useState<Explorer>("solana.fm");
  useEffect(() => { setCurrent(getExplorer()); }, []);

  return (
    <select
      value={current}
      onChange={(e) => {
        const val = e.target.value as Explorer;
        setExplorer(val);
        setCurrent(val);
      }}
      className="hidden rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand sm:block"
      title="Choose block explorer"
    >
      {EXPLORERS.map((ex) => (
        <option key={ex.value} value={ex.value}>{ex.label}</option>
      ))}
    </select>
  );
}
