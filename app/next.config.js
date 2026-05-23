/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // wallet-adapter-react-ui ships ESM that Next needs to transpile.
  transpilePackages: [
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-base",
  ],
  webpack: (config) => {
    // SPL/Solana libs reference these node-only modules; stub them in the browser bundle.
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      stream: false,
      "pino-pretty": false,
    };

    // Silence noisy transitive warnings from `ox` / `viem` deep inside the
    // WalletConnect adapter — we don't actually use WalletConnect (only
    // Phantom + Solflare are registered in src/app/providers.tsx), so the
    // "Critical dependency: the request of a dependency is an expression"
    // warnings from `ox/_esm/tempo/internal/virtualMasterPool.js` are noise.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /node_modules\/ox\// },
      { module: /node_modules\/@walletconnect\// },
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];

    return config;
  },
};

module.exports = nextConfig;
