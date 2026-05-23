import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-wash">
        <span className="font-mono text-3xl font-bold text-brand">404</span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-ink-muted">
          That URL does not exist. Pick a feature below to get started.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {[
          { href: "/vault",   label: "Vault"    },
          { href: "/flux",    label: "Flux AMM" },
          { href: "/stream",  label: "Auto-pay" },
          { href: "/lockbox", label: "Lockbox"  },
          { href: "/grid",    label: "Grid"     },
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:border-brand hover:text-brand"
          >
            {label}
          </Link>
        ))}
      </div>
      <Link href="/" className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink transition">
        Back to home
      </Link>
    </div>
  );
}
