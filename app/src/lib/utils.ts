import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const RLO_DECIMALS = 6;

/** Format raw base-unit u64 (as BN/bigint/string) into "1,234.56 $RLO". */
export function formatRlo(raw: bigint | number | string): string {
  const big = typeof raw === "bigint" ? raw : BigInt(String(raw));
  const divisor = 10n ** BigInt(RLO_DECIMALS);
  const whole = big / divisor;
  const frac = big % divisor;
  const fracStr = frac
    .toString()
    .padStart(RLO_DECIMALS, "0")
    .slice(0, 2)
    .padEnd(2, "0");
  return `${whole.toLocaleString()}.${fracStr}`;
}

/** Inverse: "1234.56" -> raw bigint (1234560000 with 6 decimals). */
export function parseRloToRaw(input: string): bigint {
  if (!input) return 0n;
  const [whole = "0", frac = ""] = input.replace(/,/g, "").split(".");
  const fracPadded = (frac + "0".repeat(RLO_DECIMALS)).slice(0, RLO_DECIMALS);
  return BigInt(whole) * 10n ** BigInt(RLO_DECIMALS) + BigInt(fracPadded || "0");
}

export type Explorer = "solana.fm" | "solscan" | "solanaexplorer";

const EXPLORER_URLS: Record<Explorer, (sig: string) => string> = {
  "solana.fm": (sig) => "https://solana.fm/tx/" + sig + "?cluster=devnet-solana",
  "solscan": (sig) => "https://solscan.io/tx/" + sig + "?cluster=devnet",
  "solanaexplorer": (sig) => "https://explorer.solana.com/tx/" + sig + "?cluster=devnet",
};

export function getExplorer(): Explorer {
  if (typeof window === "undefined") return "solana.fm";
  return (localStorage.getItem("kado_explorer") as Explorer) ?? "solana.fm";
}

export function setExplorer(e: Explorer): void {
  localStorage.setItem("kado_explorer", e);
}

export function txLink(sig: string): string {
  return EXPLORER_URLS[getExplorer()](sig);
}

export function short(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
