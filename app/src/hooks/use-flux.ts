"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  buildProvider,
  fluxProgram,
  fluxPoolPda,
  fluxLpMintPda,
  RLO_MINT_PK,
  USDC_MINT_PK,
  canonicalMintOrder,
} from "@/lib/anchor";

const FEE_BPS = 30;

export type PoolState = {
  exists: boolean;
  mintA: PublicKey;
  mintB: PublicKey;
  aIsRlo: boolean;
  reserveA: bigint;
  reserveB: bigint;
  lpSupply: bigint;
  feeBps: number;
};

const [MINT_A, MINT_B] = canonicalMintOrder(RLO_MINT_PK, USDC_MINT_PK);
const A_IS_RLO = MINT_A.equals(RLO_MINT_PK);

const EMPTY: PoolState = {
  exists: false,
  mintA: MINT_A,
  mintB: MINT_B,
  aIsRlo: A_IS_RLO,
  reserveA: 0n,
  reserveB: 0n,
  lpSupply: 0n,
  feeBps: FEE_BPS,
};

export function useFlux() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [pool, setPool] = useState<PoolState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  const [poolPda] = useMemo(() => fluxPoolPda(MINT_A, MINT_B), []);
  const [lpMintPda] = useMemo(() => fluxLpMintPda(poolPda), [poolPda]);

  const fetchPool = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    try {
      const provider = buildProvider(connection, wallet as any);
      const prog = fluxProgram(provider);
      const acc = await (prog.account as any).ammPool.fetchNullable(poolPda);
      if (!acc) {
        setPool(EMPTY);
        return;
      }
      setPool({
        exists: true,
        mintA: MINT_A,
        mintB: MINT_B,
        aIsRlo: A_IS_RLO,
        reserveA: BigInt(acc.tokenAReserve.toString()),
        reserveB: BigInt(acc.tokenBReserve.toString()),
        lpSupply: BigInt(acc.lpSupply.toString()),
        feeBps: acc.feeBps,
      });
    } catch (e) {
      console.error("flux fetchPool failed", e);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet, poolPda]);

  useEffect(() => {
    fetchPool();
  }, [fetchPool, tick]);

  /** rloAmountRaw -> expected usdcOut (or vice versa), accounting for the fee */
  function quote(amountIn: bigint, rloIn: boolean): bigint {
    const reserveIn = rloIn
      ? pool.aIsRlo
        ? pool.reserveA
        : pool.reserveB
      : pool.aIsRlo
      ? pool.reserveB
      : pool.reserveA;
    const reserveOut = rloIn
      ? pool.aIsRlo
        ? pool.reserveB
        : pool.reserveA
      : pool.aIsRlo
      ? pool.reserveA
      : pool.reserveB;
    if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n) return 0n;
    const fee = BigInt(pool.feeBps);
    const inWithFee = amountIn * (10000n - fee);
    return (inWithFee * reserveOut) / (reserveIn * 10000n + inWithFee);
  }

  /** spot price of the *output* token in units of the *input* token. */
  function priceImpactPct(amountIn: bigint, rloIn: boolean): number {
    if (amountIn === 0n) return 0;
    const out = quote(amountIn, rloIn);
    if (out === 0n) return 0;
    // Effective price per unit of input.
    const effective = Number(out) / Number(amountIn);
    // Spot mid-price.
    const reserveIn = rloIn
      ? pool.aIsRlo
        ? pool.reserveA
        : pool.reserveB
      : pool.aIsRlo
      ? pool.reserveB
      : pool.reserveA;
    const reserveOut = rloIn
      ? pool.aIsRlo
        ? pool.reserveB
        : pool.reserveA
      : pool.aIsRlo
      ? pool.reserveA
      : pool.reserveB;
    if (reserveIn === 0n) return 0;
    const spot = Number(reserveOut) / Number(reserveIn);
    if (spot === 0) return 0;
    return Math.max(0, (1 - effective / spot) * 100);
  }

  // Re-fetches the user's LP balance every 6s. Returns base-unit bigint.
  const [lpBalance, setLpBalance] = useState<bigint>(0n);
  useEffect(() => {
    if (!wallet.publicKey) return;
    let cancelled = false;
    async function refresh() {
      try {
        const lpAta = getAssociatedTokenAddressSync(lpMintPda, wallet.publicKey!);
        const acc = await getAccount(connection, lpAta);
        if (!cancelled) setLpBalance(acc.amount);
      } catch {
        if (!cancelled) setLpBalance(0n);
      }
    }
    refresh();
    const id = setInterval(refresh, 6_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wallet.publicKey, connection, lpMintPda, tick]);

  // For a deposit of `amountA` of token A, what's the matching B?
  // Returns 0n if pool is empty (first deposit can set any ratio).
  function pairedAmountB(amountA: bigint): bigint {
    if (pool.reserveA === 0n || pool.reserveB === 0n) return 0n;
    return (amountA * pool.reserveB) / pool.reserveA;
  }
  function pairedAmountA(amountB: bigint): bigint {
    if (pool.reserveA === 0n || pool.reserveB === 0n) return 0n;
    return (amountB * pool.reserveA) / pool.reserveB;
  }

  /** Estimated LP tokens for a deposit (matches the on-chain formula). */
  function quoteLpMint(amountA: bigint, amountB: bigint): bigint {
    if (pool.lpSupply === 0n) {
      // First deposit: floor(sqrt(a*b)) - MIN_LIQUIDITY (1000).
      const prod = amountA * amountB;
      const root = bigintSqrt(prod);
      return root > 1000n ? root - 1000n : 0n;
    }
    const fromA = (amountA * pool.lpSupply) / pool.reserveA;
    const fromB = (amountB * pool.lpSupply) / pool.reserveB;
    return fromA < fromB ? fromA : fromB;
  }

  /** Pro-rata reserves a user would withdraw for `lpAmount` LP tokens. */
  function quoteWithdraw(lpAmount: bigint): { a: bigint; b: bigint } {
    if (pool.lpSupply === 0n) return { a: 0n, b: 0n };
    return {
      a: (lpAmount * pool.reserveA) / pool.lpSupply,
      b: (lpAmount * pool.reserveB) / pool.lpSupply,
    };
  }

  const addLiquidity = useCallback(
    async (amountA: bigint, amountB: bigint) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = fluxProgram(provider);
      const owner = wallet.publicKey;
      const userA = getAssociatedTokenAddressSync(MINT_A, owner);
      const userB = getAssociatedTokenAddressSync(MINT_B, owner);
      const userLp = getAssociatedTokenAddressSync(lpMintPda, owner);
      const poolTokenA = getAssociatedTokenAddressSync(MINT_A, poolPda, true);
      const poolTokenB = getAssociatedTokenAddressSync(MINT_B, poolPda, true);

      // The on-chain accounts struct expects user_lp_account to already exist;
      // create it idempotently in the same tx so first-time LPs don't fail.
      const preIxs = [
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          userLp,
          owner,
          lpMintPda
        ),
      ];

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .addLiquidity(new BN(amountA.toString()), new BN(amountB.toString()))
          .accounts({
            pool: poolPda,
            lpMint: lpMintPda,
            poolTokenA,
            poolTokenB,
            userTokenA: userA,
            userTokenB: userB,
            userLpAccount: userLp,
            user: owner,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .preInstructions(preIxs)
          .rpc();
        return sig;
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection, poolPda, lpMintPda]
  );

  const removeLiquidity = useCallback(
    async (lpAmount: bigint) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = fluxProgram(provider);
      const owner = wallet.publicKey;
      const userA = getAssociatedTokenAddressSync(MINT_A, owner);
      const userB = getAssociatedTokenAddressSync(MINT_B, owner);
      const userLp = getAssociatedTokenAddressSync(lpMintPda, owner);
      const poolTokenA = getAssociatedTokenAddressSync(MINT_A, poolPda, true);
      const poolTokenB = getAssociatedTokenAddressSync(MINT_B, poolPda, true);

      // Ensure A & B ATAs exist on the LP's wallet (no-op if they do).
      const preIxs = [
        createAssociatedTokenAccountIdempotentInstruction(owner, userA, owner, MINT_A),
        createAssociatedTokenAccountIdempotentInstruction(owner, userB, owner, MINT_B),
      ];

      setSubmitting(true);
      try {
        const sig = await prog.methods
          .removeLiquidity(new BN(lpAmount.toString()))
          .accounts({
            pool: poolPda,
            lpMint: lpMintPda,
            poolTokenA,
            poolTokenB,
            userTokenA: userA,
            userTokenB: userB,
            userLpAccount: userLp,
            user: owner,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .preInstructions(preIxs)
          .rpc();
        return sig;
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection, poolPda, lpMintPda]
  );

  const swap = useCallback(
    async (amountIn: bigint, minOut: bigint, rloIn: boolean) => {
      if (!wallet.publicKey) throw new Error("Connect wallet first.");
      const provider = buildProvider(connection, wallet as any);
      const prog = fluxProgram(provider);
      const owner = wallet.publicKey;

      // a_to_b means user supplies token A. Map from "rloIn" → a_to_b.
      // If A is RLO and rloIn, then a_to_b = true.
      // If A is USDC and !rloIn, then a_to_b = true.
      const aToB = pool.aIsRlo ? rloIn : !rloIn;

      const inMint = rloIn ? RLO_MINT_PK : USDC_MINT_PK;
      const outMint = rloIn ? USDC_MINT_PK : RLO_MINT_PK;
      const userIn = getAssociatedTokenAddressSync(inMint, owner);
      const userOut = getAssociatedTokenAddressSync(outMint, owner);
      const poolTokenA = getAssociatedTokenAddressSync(MINT_A, poolPda, true);
      const poolTokenB = getAssociatedTokenAddressSync(MINT_B, poolPda, true);

      setSubmitting(true);
      try {
        // Ensure output ATA exists before swap (wallet may never have held this token)
        const outAtaInfo = await connection.getAccountInfo(userOut);
        if (!outAtaInfo) {
          const createTx = new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(owner, userOut, owner, outMint)
          );
          await (wallet as any).sendTransaction(createTx, connection);
          await new Promise((r) => setTimeout(r, 2000));
        }
        const sig = await prog.methods
          .swap(new BN(amountIn.toString()), new BN(minOut.toString()), aToB)
          .accounts({
            pool: poolPda,
            poolTokenA,
            poolTokenB,
            userTokenIn: userIn,
            userTokenOut: userOut,
            user: owner,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .rpc();
        return sig;
      } finally {
        setSubmitting(false);
        setTick((t) => t + 1);
      }
    },
    [wallet, connection, pool, poolPda]
  );

  return {
    pool,
    loading,
    submitting,
    lpBalance,
    quote,
    priceImpactPct,
    pairedAmountA,
    pairedAmountB,
    quoteLpMint,
    quoteWithdraw,
    swap,
    addLiquidity,
    removeLiquidity,
    refresh: () => setTick((t) => t + 1),
  };
}

// Integer sqrt for bigint — Newton's method.
function bigintSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("sqrt of negative");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}
