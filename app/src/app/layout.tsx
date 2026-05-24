import type { Metadata } from "next";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "./providers";
import { ToasterWithTheme } from "@/components/toaster-with-theme";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Kado",
  description: "DeFi + Agent Economy on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('kado_theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-bg text-ink min-h-screen font-sans">
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">{children}</main>
          <ToasterWithTheme />
        </Providers>
      </body>
    </html>
  );
}
