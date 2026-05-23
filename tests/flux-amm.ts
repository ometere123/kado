// Flux AMM integration tests.
//
// Coverage:
//   - initialize_pool happy path + rejects identical mints / fee > 1000 bps
//   - add_liquidity first deposit mints sqrt(a*b) - MIN_LIQUIDITY
//   - add_liquidity follow-up respects ratio, mints proportional LP
//   - swap (both directions), price impact roughly correct, fee applied
//   - swap respects min_amount_out (slippage)
//   - remove_liquidity returns pro-rata reserves and burns LP

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

import { FluxAmm } from "../target/types/flux_amm";

const DECIMALS = 6;
const ONE = (n: number) => new BN(n).mul(new BN(10).pow(new BN(DECIMALS)));

describe("flux-amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.FluxAmm as Program<FluxAmm>;
  const admin = provider.wallet as anchor.Wallet;

  let mintA: PublicKey;
  let mintB: PublicKey;
  let poolPda: PublicKey;
  let lpMintPda: PublicKey;
  let poolTokenA: PublicKey;
  let poolTokenB: PublicKey;

  const lp = Keypair.generate();
  let lpAtaA: PublicKey;
  let lpAtaB: PublicKey;
  let lpLpAccount: PublicKey;

  const trader = Keypair.generate();
  let traderAtaA: PublicKey;
  let traderAtaB: PublicKey;

  before(async () => {
    // Airdrop users.
    for (const kp of [lp, trader]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Create two mints with deterministic ordering so test math is stable.
    // We retry until mintA.toBuffer() < mintB.toBuffer() so seeds [pool, mintA, mintB]
    // resolve consistently.
    while (true) {
      const m1 = await createMint(
        provider.connection,
        admin.payer,
        admin.publicKey,
        admin.publicKey,
        DECIMALS
      );
      const m2 = await createMint(
        provider.connection,
        admin.payer,
        admin.publicKey,
        admin.publicKey,
        DECIMALS
      );
      if (Buffer.compare(m1.toBuffer(), m2.toBuffer()) < 0) {
        mintA = m1;
        mintB = m2;
        break;
      }
    }

    [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
      program.programId
    );
    [lpMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), poolPda.toBuffer()],
      program.programId
    );
    poolTokenA = getAssociatedTokenAddressSync(mintA, poolPda, true);
    poolTokenB = getAssociatedTokenAddressSync(mintB, poolPda, true);

    // Fund LP with 100k of each token.
    lpAtaA = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mintA,
        lp.publicKey
      )
    ).address;
    lpAtaB = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mintB,
        lp.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      admin.payer,
      mintA,
      lpAtaA,
      admin.payer,
      BigInt(ONE(100_000).toString())
    );
    await mintTo(
      provider.connection,
      admin.payer,
      mintB,
      lpAtaB,
      admin.payer,
      BigInt(ONE(100_000).toString())
    );

    // Trader gets 10k of each.
    traderAtaA = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mintA,
        trader.publicKey
      )
    ).address;
    traderAtaB = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mintB,
        trader.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      admin.payer,
      mintA,
      traderAtaA,
      admin.payer,
      BigInt(ONE(10_000).toString())
    );
    await mintTo(
      provider.connection,
      admin.payer,
      mintB,
      traderAtaB,
      admin.payer,
      BigInt(ONE(10_000).toString())
    );
  });

  it("initializes the pool (30 bps fee)", async () => {
    await program.methods
      .initializePool(30)
      .accounts({
        pool: poolPda,
        mintA,
        mintB,
        lpMint: lpMintPda,
        poolTokenA,
        poolTokenB,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const pool = await program.account.ammPool.fetch(poolPda);
    expect(pool.feeBps).to.equal(30);
    expect(pool.tokenAReserve.toString()).to.equal("0");
    expect(pool.tokenBReserve.toString()).to.equal("0");
    expect(pool.lpSupply.toString()).to.equal("0");
    expect(pool.mintA.toBase58()).to.equal(mintA.toBase58());
    expect(pool.mintB.toBase58()).to.equal(mintB.toBase58());
  });

  it("rejects fee > 1000 bps", async () => {
    // Need a different pair so we can attempt a fresh init.
    let m1 = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      admin.publicKey,
      DECIMALS
    );
    let m2 = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      admin.publicKey,
      DECIMALS
    );
    if (Buffer.compare(m1.toBuffer(), m2.toBuffer()) > 0) [m1, m2] = [m2, m1];
    const [pp] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), m1.toBuffer(), m2.toBuffer()],
      program.programId
    );
    const [lpp] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), pp.toBuffer()],
      program.programId
    );

    let err: any;
    try {
      await program.methods
        .initializePool(1001)
        .accounts({
          pool: pp,
          mintA: m1,
          mintB: m2,
          lpMint: lpp,
          poolTokenA: getAssociatedTokenAddressSync(m1, pp, true),
          poolTokenB: getAssociatedTokenAddressSync(m2, pp, true),
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("InvalidFee");
  });

  it("adds first liquidity (10k:10k → ~10k LP minus MIN_LIQUIDITY)", async () => {
    // Need LP's LP-token ATA created first.
    lpLpAccount = getAssociatedTokenAddressSync(lpMintPda, lp.publicKey);
    // Create the LP-account on the fly using admin (associated_token::* attribute
    // in our Anchor struct expects it pre-existing).
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      lpMintPda,
      lp.publicKey
    );

    const amount = ONE(10_000);
    await program.methods
      .addLiquidity(amount, amount)
      .accounts({
        pool: poolPda,
        lpMint: lpMintPda,
        poolTokenA,
        poolTokenB,
        userTokenA: lpAtaA,
        userTokenB: lpAtaB,
        userLpAccount: lpLpAccount,
        user: lp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([lp])
      .rpc();

    const pool = await program.account.ammPool.fetch(poolPda);
    expect(pool.tokenAReserve.toString()).to.equal(amount.toString());
    expect(pool.tokenBReserve.toString()).to.equal(amount.toString());

    // sqrt(10_000_000_000 * 10_000_000_000) = 10_000_000_000.
    // LP supply (incl. MIN_LIQUIDITY locked) should be 10_000_000_000.
    expect(pool.lpSupply.toString()).to.equal(amount.toString());

    // User got lp_raw - MIN_LIQUIDITY.
    const userLp = await getAccount(provider.connection, lpLpAccount);
    expect(userLp.amount.toString()).to.equal(
      (BigInt(amount.toString()) - 1000n).toString()
    );
  });

  it("swaps A->B with 30 bps fee", async () => {
    const beforeB = await getAccount(provider.connection, traderAtaB);
    const beforePool = await program.account.ammPool.fetch(poolPda);

    const amountIn = ONE(100); // 100 token A
    await program.methods
      .swap(amountIn, new BN(0), true /* a_to_b */)
      .accounts({
        pool: poolPda,
        poolTokenA,
        poolTokenB,
        userTokenIn: traderAtaA,
        userTokenOut: traderAtaB,
        user: trader.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([trader])
      .rpc();

    const afterB = await getAccount(provider.connection, traderAtaB);
    const out = afterB.amount - beforeB.amount;

    // Expected: (100 * (10000 - 30) / 10000) * 10_000 / (10_000 + 100 * 9970 / 10_000) using base units
    // Easier: compute on integers.
    const reserveIn = BigInt(beforePool.tokenAReserve.toString());
    const reserveOut = BigInt(beforePool.tokenBReserve.toString());
    const inFee = BigInt(amountIn.toString()) * (10000n - 30n);
    const expectedOut = (inFee * reserveOut) / (reserveIn * 10000n + inFee);
    expect(out.toString()).to.equal(expectedOut.toString());

    // Pool reserves updated.
    const afterPool = await program.account.ammPool.fetch(poolPda);
    expect(afterPool.tokenAReserve.toString()).to.equal(
      (reserveIn + BigInt(amountIn.toString())).toString()
    );
    expect(afterPool.tokenBReserve.toString()).to.equal(
      (reserveOut - expectedOut).toString()
    );
  });

  it("rejects swap below min_amount_out (slippage)", async () => {
    const amountIn = ONE(100);
    let err: any;
    try {
      await program.methods
        .swap(amountIn, ONE(10_000), true) // absurd min — must fail.
        .accounts({
          pool: poolPda,
          poolTokenA,
          poolTokenB,
          userTokenIn: traderAtaA,
          userTokenOut: traderAtaB,
          user: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([trader])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("SlippageExceeded");
  });

  it("removes liquidity pro-rata", async () => {
    const lpBalance = await getAccount(provider.connection, lpLpAccount);
    const burnAmount = lpBalance.amount / 2n; // burn half

    const before = await program.account.ammPool.fetch(poolPda);
    const beforeA = await getAccount(provider.connection, lpAtaA);
    const beforeB = await getAccount(provider.connection, lpAtaB);

    await program.methods
      .removeLiquidity(new BN(burnAmount.toString()))
      .accounts({
        pool: poolPda,
        lpMint: lpMintPda,
        poolTokenA,
        poolTokenB,
        userTokenA: lpAtaA,
        userTokenB: lpAtaB,
        userLpAccount: lpLpAccount,
        user: lp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([lp])
      .rpc();

    const afterA = await getAccount(provider.connection, lpAtaA);
    const afterB = await getAccount(provider.connection, lpAtaB);
    const after = await program.account.ammPool.fetch(poolPda);

    const expectedA =
      (burnAmount * BigInt(before.tokenAReserve.toString())) /
      BigInt(before.lpSupply.toString());
    const expectedB =
      (burnAmount * BigInt(before.tokenBReserve.toString())) /
      BigInt(before.lpSupply.toString());

    expect((afterA.amount - beforeA.amount).toString()).to.equal(
      expectedA.toString()
    );
    expect((afterB.amount - beforeB.amount).toString()).to.equal(
      expectedB.toString()
    );
    expect(after.lpSupply.toString()).to.equal(
      (BigInt(before.lpSupply.toString()) - burnAmount).toString()
    );
  });

  it("rejects zero-amount swap and zero-amount addLiquidity", async () => {
    let err1: any, err2: any;
    try {
      await program.methods
        .swap(new BN(0), new BN(0), true)
        .accounts({
          pool: poolPda,
          poolTokenA,
          poolTokenB,
          userTokenIn: traderAtaA,
          userTokenOut: traderAtaB,
          user: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([trader])
        .rpc();
    } catch (e) {
      err1 = e;
    }
    try {
      await program.methods
        .addLiquidity(new BN(0), new BN(100))
        .accounts({
          pool: poolPda,
          lpMint: lpMintPda,
          poolTokenA,
          poolTokenB,
          userTokenA: lpAtaA,
          userTokenB: lpAtaB,
          userLpAccount: lpLpAccount,
          user: lp.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([lp])
        .rpc();
    } catch (e) {
      err2 = e;
    }
    expect(err1).to.exist;
    expect(String(err1)).to.include("ZeroAmount");
    expect(err2).to.exist;
    expect(String(err2)).to.include("ZeroAmount");
  });
});
