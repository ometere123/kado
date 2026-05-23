import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy aliases — kept for backwards compat, not dark-mode aware
        navy:   { DEFAULT: "#F5F0E8", mid: "#FAFAF7", light: "#1A1A1A" },
        violet: { DEFAULT: "#2A9D8F", light: "#E8F5F3", mid: "#2A9D8F", dark: "#1F7268" },
        orange: { DEFAULT: "#1F7268", light: "#E8F5F3", dark: "#154D46" },

        // Semantic tokens — CSS-var backed, respond to dark mode
        bg:      { DEFAULT: "rgb(var(--color-bg) / <alpha-value>)" },
        surface: { DEFAULT: "rgb(var(--color-surface) / <alpha-value>)" },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          muted:   "rgb(var(--color-ink-muted) / <alpha-value>)",
        },
        line:  { DEFAULT: "rgb(var(--color-line) / <alpha-value>)" },
        brand: {
          DEFAULT: "rgb(var(--color-brand) / <alpha-value>)",
          wash:    "rgb(var(--color-brand-wash) / <alpha-value>)",
          dark:    "rgb(var(--color-brand-dark) / <alpha-value>)",
        },
        cta: {
          DEFAULT: "rgb(var(--color-cta) / <alpha-value>)",
          hover:   "rgb(var(--color-cta-hover) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
