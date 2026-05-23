import type { Config } from "tailwindcss";

// Rialo palette — warm beige + teal, light theme.
//
//   Role            Token          Hex
//   ----------------------------------------
//   Background      bg / navy      #F5F0E8
//   Surface/cards   surface/navy.mid #FAFAF7
//   Brand accent    brand/violet   #2A9D8F
//   Accent tint     brand.wash/violet.light #E8F5F3
//   CTA             cta/orange     #1F7268
//   Body text       ink/navy.light #1A1A1A
//   Secondary text  ink.muted      #6B6B6B
//   Border          line           #E0D9CE
//
// The legacy `navy/violet/orange` names are kept as aliases pointing at the
// new values so existing component class names continue to work; the semantic
// tokens (bg/surface/brand/cta/ink/line) are preferred for new code.

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy aliases — remapped to the Rialo palette.
        navy: {
          DEFAULT: "#F5F0E8",
          mid: "#FAFAF7",
          light: "#1A1A1A",
        },
        violet: {
          DEFAULT: "#2A9D8F",
          light: "#E8F5F3",
          mid: "#2A9D8F",
          dark: "#1F7268",
        },
        orange: {
          DEFAULT: "#1F7268",
          light: "#E8F5F3",
          dark: "#154D46",
        },

        // Semantic tokens — preferred.
        bg: { DEFAULT: "#F5F0E8" },
        surface: { DEFAULT: "#FAFAF7" },
        ink: { DEFAULT: "#1A1A1A", muted: "#6B6B6B" },
        line: { DEFAULT: "#E0D9CE" },
        brand: { DEFAULT: "#2A9D8F", wash: "#E8F5F3", dark: "#1F7268" },
        cta: { DEFAULT: "#1F7268", hover: "#154D46" },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
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
