// Nexus Protocol shared config.
//
// This file is the single source of truth for on-chain addresses used by both
// the contracts test suite and the Next.js frontend.
//
// RLO_MINT is populated by `scripts/deploy-token.ts`.
// Program IDs are populated after `anchor deploy`.

export const RLO_MINT = "B89FfvaUJxGcEqmxszCTUeQ1besS6bMx8j7X4jhkEBms";
export const USDC_MINT = "c2PGLdTjGGL6Etq21ouJp5cSpn34zvSqA75rrfb9Mv6";

export const VAULT_PROGRAM_ID = "7ReQsccnwt5qe3bcE3G3X7t5qmLMBMqzSMKJqu69eeTj";
export const FLUX_AMM_PROGRAM_ID = "528sS3JkYnhruKWxK4n1mZNJqrVY4qLoRkjmV6D9inVW";
export const STREAMLINE_PROGRAM_ID = "CXcZSw9VYBWE9UiZ6QyXcNugxLYo4AbtdiPY849CQ767";
export const LOCKBOX_PROGRAM_ID = "3x3vj8CQXrbZuajp7g4eq3bUhbzffbhiXX2RC1UfmGhr";
export const FORGE_PROGRAM_ID = "7WZXB6stHDsHgq8fUS4RfSu8UyDJWjHFCQbULGarErp4";

export const CLUSTER = "devnet";
export const EXPLORER_BASE = "https://solana.fm/tx";

// Token metadata (kept here so UI labels stay consistent with the on-chain mint).
export const RLO_NAME = "RLO Token";
export const RLO_SYMBOL = "$RLO";
export const RLO_DECIMALS = 6;

export const USDC_NAME = "Mock USDC";
export const USDC_SYMBOL = "$USDC";
export const USDC_DECIMALS = 6;
