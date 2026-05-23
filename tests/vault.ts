// Vault program tests.
//
// `anchor test` spins up solana-test-validator, deploys the programs from
// target/deploy, and runs this suite. We create a fresh $RLO-like mint per
// test run so we never depend on devnet state.
//
// Coverage:
//   - initialize_treasury / initialize_vault happy paths
//   - stake / borrow / repay / withdraw token movements
//   - LTV enforcement (borrow over haircut limit fails)
//   - withdraw blocked when remaining collateral wouldn't cover borrow
//   - invalid credit_rating / haircut_bps rejected
//   - repay of more than outstanding rejected

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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

import { Vault } from "../target/types/vault";

const RLO_DECIMALS = 6;
const RLO = (whole: number) => new BN(whole).mul(new BN(10).pow(new BN(RLO_DECIMALS)));

describe("vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;

  const admin = provider.wallet as anchor.Wallet;
  let rloMint: PublicKey;
  let adminAta: PublicKey;
  let treasuryPda: PublicKey;
  let treasuryAta: PublicKey;

  // Per-test user — fresh keypair each `it()` block where useful.
  // For shared state tests we use a single user across the describe.
  const user = Keypair.generate();
  let userAta: PublicKey;
  let vaultPda: PublicKey;
  let vaultAta: PublicKey;

  before(async () => {
    // Airdrop user some SOL for rent + signing.
    const sig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Create a fresh mint controlled by the admin (test wallet).
    rloMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      admin.publicKey,
      RLO_DECIMALS
    );

    // Admin ATA + mint a big pile so admin can fund treasury and user.
    const adminAtaInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rloMint,
      admin.publicKey
    );
    adminAta = adminAtaInfo.address;
    await mintTo(
      provider.connection,
      admin.payer,
      rloMint,
      adminAta,
      admin.payer,
      Number(RLO(1_000_000).toString())
    );

    // User ATA + send the user 10k RLO to play with.
    const userAtaInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rloMint,
      user.publicKey
    );
    userAta = userAtaInfo.address;

    // Transfer from admin -> user via mintTo (admin is mint authority).
    await mintTo(
      provider.connection,
      admin.payer,
      rloMint,
      userAta,
      admin.payer,
      Number(RLO(10_000).toString())
    );

    // Compute PDAs.
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );
    treasuryAta = getAssociatedTokenAddressSync(rloMint, treasuryPda, true);

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), user.publicKey.toBuffer()],
      program.programId
    );
    vaultAta = getAssociatedTokenAddressSync(rloMint, vaultPda, true);
  });

  it("initializes the treasury", async () => {
    await program.methods
      .initializeTreasury()
      .accounts({
        treasury: treasuryPda,
        rloMint,
        treasuryTokenAccount: treasuryAta,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);
    expect(treasury.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(treasury.rloMint.toBase58()).to.equal(rloMint.toBase58());

    // Fund treasury with 100k RLO so borrows can succeed later.
    await mintTo(
      provider.connection,
      admin.payer,
      rloMint,
      treasuryAta,
      admin.payer,
      Number(RLO(100_000).toString())
    );
    const treasuryBal = await getAccount(provider.connection, treasuryAta);
    expect(treasuryBal.amount.toString()).to.equal(RLO(100_000).toString());
  });

  it("initializes a user vault", async () => {
    // Tier 4 → 70% max LTV under the on-chain tier mapping. Initialize with the
    // explicit haircut_bps too — that field is now redundant for new vaults
    // (tier drives LTV) but the program still accepts it for forward-compat.
    await program.methods
      .initializeVault(4, 7000)
      .accounts({
        vault: vaultPda,
        rloMint,
        vaultTokenAccount: vaultAta,
        owner: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([user])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    expect(vault.owner.toBase58()).to.equal(user.publicKey.toBase58());
    expect(vault.stakedAmount.toString()).to.equal("0");
    expect(vault.borrowedAmount.toString()).to.equal("0");
    expect(vault.creditRating).to.equal(4);
    expect(vault.haircutBps).to.equal(7000);
  });

  it("rejects invalid credit_rating", async () => {
    const badUser = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      badUser.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const [badVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), badUser.publicKey.toBuffer()],
      program.programId
    );
    const badVaultAta = getAssociatedTokenAddressSync(rloMint, badVaultPda, true);

    let err: any;
    try {
      await program.methods
        .initializeVault(0, 5000)
        .accounts({
          vault: badVaultPda,
          rloMint,
          vaultTokenAccount: badVaultAta,
          owner: badUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([badUser])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("InvalidCreditRating");
  });

  it("rejects haircut > 10000 bps", async () => {
    const badUser = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      badUser.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const [badVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), badUser.publicKey.toBuffer()],
      program.programId
    );
    const badVaultAta = getAssociatedTokenAddressSync(rloMint, badVaultPda, true);

    let err: any;
    try {
      await program.methods
        .initializeVault(3, 10001)
        .accounts({
          vault: badVaultPda,
          rloMint,
          vaultTokenAccount: badVaultAta,
          owner: badUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([badUser])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("InvalidHaircut");
  });

  it("stakes RLO into the vault", async () => {
    const amount = RLO(1_000); // 1000 RLO
    await program.methods
      .stake(amount)
      .accounts({
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        ownerTokenAccount: userAta,
        rloMint,
        owner: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    expect(vault.stakedAmount.toString()).to.equal(amount.toString());

    const vaultBal = await getAccount(provider.connection, vaultAta);
    expect(vaultBal.amount.toString()).to.equal(amount.toString());
  });

  it("borrows within LTV (70% of 1000 = 700)", async () => {
    const amount = RLO(700);
    await program.methods
      .borrow(amount)
      .accounts({
        vault: vaultPda,
        treasury: treasuryPda,
        treasuryTokenAccount: treasuryAta,
        ownerTokenAccount: userAta,
        rloMint,
        owner: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    expect(vault.borrowedAmount.toString()).to.equal(amount.toString());

    const userBal = await getAccount(provider.connection, userAta);
    // User had 10000, staked 1000 (now 9000), borrowed 700 → 9700.
    expect(userBal.amount.toString()).to.equal(RLO(9_700).toString());
  });

  it("rejects borrow exceeding LTV", async () => {
    // already borrowed 700/700 max — even 1 more should fail.
    let err: any;
    try {
      await program.methods
        .borrow(new BN(1))
        .accounts({
          vault: vaultPda,
          treasury: treasuryPda,
          treasuryTokenAccount: treasuryAta,
          ownerTokenAccount: userAta,
          rloMint,
          owner: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([user])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("ExceedsBorrowLimit");
  });

  it("repays partial borrow", async () => {
    const amount = RLO(200);
    await program.methods
      .repay(amount)
      .accounts({
        vault: vaultPda,
        treasury: treasuryPda,
        treasuryTokenAccount: treasuryAta,
        ownerTokenAccount: userAta,
        rloMint,
        owner: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    expect(vault.borrowedAmount.toString()).to.equal(RLO(500).toString());
  });

  it("rejects repay exceeding outstanding borrow", async () => {
    let err: any;
    try {
      await program.methods
        .repay(RLO(10_000))
        .accounts({
          vault: vaultPda,
          treasury: treasuryPda,
          treasuryTokenAccount: treasuryAta,
          ownerTokenAccount: userAta,
          rloMint,
          owner: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([user])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("ExceedsBorrowedAmount");
  });

  it("rejects withdraw that would under-collateralize", async () => {
    // staked = 1000, borrowed = 500. haircut = 70%.
    // min staked to cover 500 borrow at 70% LTV = 500 / 0.7 ≈ 715 (rounded up).
    // So withdrawing 400 would leave 600 < 715 — should fail.
    let err: any;
    try {
      await program.methods
        .withdraw(RLO(400))
        .accounts({
          vault: vaultPda,
          vaultTokenAccount: vaultAta,
          ownerTokenAccount: userAta,
          rloMint,
          owner: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([user])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("InsufficientCollateral");
  });

  it("allows withdraw that keeps collateral covered", async () => {
    // staked = 1000, borrowed = 500. 500 / 0.7 = ~715 minimum staked.
    // Withdraw 200 → remaining 800 → still covers. Should succeed.
    await program.methods
      .withdraw(RLO(200))
      .accounts({
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        ownerTokenAccount: userAta,
        rloMint,
        owner: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([user])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    expect(vault.stakedAmount.toString()).to.equal(RLO(800).toString());
  });

  it("rejects stake/borrow/repay/withdraw with zero amount", async () => {
    for (const fn of ["stake", "borrow", "repay", "withdraw"] as const) {
      let err: any;
      try {
        const builder = (program.methods as any)[fn](new BN(0)).accounts({
          vault: vaultPda,
          treasury: treasuryPda,
          treasuryTokenAccount: treasuryAta,
          vaultTokenAccount: vaultAta,
          ownerTokenAccount: userAta,
          rloMint,
          owner: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        });
        await builder.signers([user]).rpc();
      } catch (e) {
        err = e;
      }
      expect(err, `${fn}(0) should fail`).to.exist;
      expect(String(err)).to.include("ZeroAmount");
    }
  });
});
