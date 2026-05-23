import type { Metadata } from "next";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";
import { Header } from "@/components/header";

// Note: we don't load Inter from Google Fonts because the dev environment can
// be offline / firewalled. Tailwind's `font-sans` already falls back to
// system-ui, which renders the UI fine without a network round-trip on boot.
export const metadata: Metadata = {
  title: "Kado",
  description: "DeFi + Agent Economy on Solana.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink min-h-screen font-sans">
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">{children}</main>
          <Toaster
            theme="light"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#FAFAF7",
                border: "1px solid #E0D9CE",
                color: "#1A1A1A",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
