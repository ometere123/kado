import Link from "next/link";
import { Vault, ArrowLeftRight, Zap } from "lucide-react";
import { LogoImage } from "@/components/logo-image";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line bg-bg">
        {/* dot-grid background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, #2A9D8F22 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-4 py-20 sm:py-28">
          <div className="flex flex-col items-start gap-6">
            {/* logo */}
            <div className="flex items-center">
              <LogoImage height={40} />
            </div>

            <h1 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
              The Connection Point.
            </h1>

            <p className="max-w-xl text-base text-ink-muted">
              Stake, borrow, swap, automate payments, post bounties — five Anchor
              programs, one token, live on Solana devnet.
            </p>

            <div className="flex flex-wrap gap-2">
              {[
                { href: "/vault",   label: "Vault",    desc: "Stake & borrow" },
                { href: "/flux",    label: "Flux AMM", desc: "Swap tokens" },
                { href: "/stream",  label: "Auto-pay", desc: "Schedule payments" },
                { href: "/lockbox", label: "Lockbox",  desc: "Safe Send" },
                { href: "/grid",    label: "Grid",     desc: "Post bounties" },
              ].map(({ href, label, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex flex-col rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-brand hover:bg-bg"
                >
                  <span className="text-sm font-semibold text-ink group-hover:text-brand transition">{label}</span>
                  <span className="text-xs text-ink-muted">{desc}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div className="grid gap-4 sm:grid-cols-3">
            <FeatureCard
              icon={<Vault className="h-5 w-5 text-brand" />}
              title="Vaults"
              body="Precision yield strategies engineered for institutional capital. Automated rebalancing across primary Solana primitives."
              stat="TVL_CAPACITY"
              statVal="UNLIMITED"
            />
            <FeatureCard
              icon={<ArrowLeftRight className="h-5 w-5 text-brand" />}
              title="Swaps"
              body="Atomic execution engine ensuring minimal slippage. Direct routing through concentrated liquidity pools."
              stat="ROUTING_SPEED"
              statVal="~400MS"
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5 text-brand" />}
              title="Agentic Rails"
              body="Seamless on-chain payment infrastructure designed for autonomous work and AI-driven transactional execution."
              stat="EXEC_ENV"
              statVal="NATIVE"
            />
          </div>
        </div>
      </section>

      {/* Programs grid */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <p className="mb-5 text-[11px] font-medium uppercase tracking-widest text-ink-muted">
            Five live programs
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {["Vault","Flux AMM","Streamline","Lockbox","Forge"].map((name) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink"
              >
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line bg-bg">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:flex sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <LogoImage height={20} />
            <span className="text-sm text-ink-muted">· Solana Devnet</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 sm:mt-0">
            <Link href="/vault" className="text-sm text-ink-muted hover:text-ink transition">Vault</Link>
            <Link href="/flux" className="text-sm text-ink-muted hover:text-ink transition">Flux</Link>
            <Link href="/stream" className="text-sm text-ink-muted hover:text-ink transition">Auto-pay</Link>
            <Link href="/lockbox" className="text-sm text-ink-muted hover:text-ink transition">Lockbox</Link>
            <Link href="/grid" className="text-sm text-ink-muted hover:text-ink transition">Grid</Link>
            <Link href="/account" className="text-sm text-ink-muted hover:text-ink transition">Account</Link>
          </div>
          <p className="mt-4 text-xs text-ink-muted sm:mt-0">
            © 2025 Kado. Demo only.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon, title, body, stat, statVal,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  stat: string;
  statVal: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-bg p-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <span className="font-semibold text-ink">{title}</span>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
      <div className="mt-auto pt-4 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted/60">
          {stat}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted/60">
          {statVal}
        </span>
      </div>
    </div>
  );
}
