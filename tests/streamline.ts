// Streamline tests.
//
// Coverage:
//   - create_schedule: escrow funded with amount_per_payment * total_payments
//   - execute_payment: first crank succeeds, second too-soon fails, after wait succeeds
//   - execute_payment: anyone (a 3rd party) can crank
//   - cancel_schedule: payer recovers remaining escrow + closes PDA
//   - rejects: zero amount, zero total_payments, invalid interval, recipient mismatch
//   - execute beyond total_payments errors with ScheduleComplete

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

import { Streamline } from "../target/types/streamline";

const DECIMALS = 6;
const RLO = (n: number) => new BN(n).mul(new BN(10).pow(new BN(DECIMALS)));

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("streamline", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Streamline as Program<Streamline>;
  const admin = provider.wallet as anchor.Wallet;

  let rloMint: PublicKey;
  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  const cranker = Keypair.generate();
  let payerAta: PublicKey;
  let recipientAta: PublicKey;
  let schedulePda: PublicKey;
  let escrowAta: PublicKey;

  before(async () => {
    for (const kp of [payer, recipient, cranker]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    rloMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      admin.publicKey,
      DECIMALS
    );

    payerAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        payer.publicKey
      )
    ).address;
    recipientAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        recipient.publicKey
      )
    ).address;

    await mintTo(
      provider.connection,
      admin.payer,
      rloMint,
      payerAta,
      admin.payer,
      BigInt(RLO(10_000).toString())
    );

    [schedulePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("schedule"),
        payer.publicKey.toBuffer(),
        recipient.publicKey.toBuffer(),
      ],
      program.programId
    );
    escrowAta = getAssociatedTokenAddressSync(rloMint, schedulePda, true);
  });

  it("creates schedule + funds escrow upfront", async () => {
    // 3 payments of 100 RLO each, 1s interval (tests can wait).
    await program.methods
      .createSchedule(recipient.publicKey, RLO(100), new BN(1), 3)
      .accounts({
        schedule: schedulePda,
        rloMint,
        escrowTokenAccount: escrowAta,
        payerTokenAccount: payerAta,
        recipientAccount: recipient.publicKey,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer])
      .rpc();

    const s = await program.account.paymentSchedule.fetch(schedulePda);
    expect(s.payer.toBase58()).to.equal(payer.publicKey.toBase58());
    expect(s.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(s.amountPerPayment.toString()).to.equal(RLO(100).toString());
    expect(s.totalPayments).to.equal(3);
    expect(s.paymentsMade).to.equal(0);
    expect(s.escrowBalance.toString()).to.equal(RLO(300).toString());

    const escrow = await getAccount(provider.connection, escrowAta);
    expect(escrow.amount.toString()).to.equal(RLO(300).toString());
  });

  it("rejects zero-amount, zero-payments, invalid interval at creation", async () => {
    // Each attempt uses a fresh (payer, recipient) pair so the schedule PDA is unique.
    async function tryCreate(
      amount: BN,
      interval: BN,
      total: number,
      recipientOverride?: PublicKey
    ) {
      const p = Keypair.generate();
      const r = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        p.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");

      const pAta = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          admin.payer,
          rloMint,
          p.publicKey
        )
      ).address;
      await mintTo(
        provider.connection,
        admin.payer,
        rloMint,
        pAta,
        admin.payer,
        BigInt(RLO(1_000).toString())
      );

      const recipientArg = recipientOverride ?? r.publicKey;
      // PDA seeds use the *instruction arg* recipient. To exercise the in-handler
      // RecipientMismatch check (rather than Anchor's seeds check) we derive the PDA
      // with the arg, so init succeeds; then the handler's require_keys_eq! against
      // recipient_account (which is still r.publicKey) is what should fire.
      const [sched] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("schedule"),
          p.publicKey.toBuffer(),
          recipientArg.toBuffer(),
        ],
        program.programId
      );
      const esc = getAssociatedTokenAddressSync(rloMint, sched, true);

      return program.methods
        .createSchedule(recipientArg, amount, interval, total)
        .accounts({
          schedule: sched,
          rloMint,
          escrowTokenAccount: esc,
          payerTokenAccount: pAta,
          recipientAccount: r.publicKey,
          payer: p.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([p])
        .rpc();
    }

    let e1: any, e2: any, e3: any, e4: any;
    try { await tryCreate(new BN(0), new BN(60), 3); } catch (e) { e1 = e; }
    try { await tryCreate(RLO(1), new BN(60), 0); } catch (e) { e2 = e; }
    try { await tryCreate(RLO(1), new BN(0), 3); } catch (e) { e3 = e; }
    try { await tryCreate(RLO(1), new BN(60), 3, Keypair.generate().publicKey); } catch (e) { e4 = e; }

    expect(String(e1)).to.include("ZeroAmount");
    expect(String(e2)).to.include("ZeroPayments");
    expect(String(e3)).to.include("InvalidInterval");
    expect(String(e4)).to.include("RecipientMismatch");
  });

  it("executes first payment immediately (payments_made=1)", async () => {
    await program.methods
      .executePayment()
      .accounts({
        schedule: schedulePda,
        escrowTokenAccount: escrowAta,
        recipientTokenAccount: recipientAta,
        cranker: cranker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([cranker])
      .rpc();

    const s = await program.account.paymentSchedule.fetch(schedulePda);
    expect(s.paymentsMade).to.equal(1);
    expect(s.escrowBalance.toString()).to.equal(RLO(200).toString());

    const r = await getAccount(provider.connection, recipientAta);
    expect(r.amount.toString()).to.equal(RLO(100).toString());
  });

  it("rejects immediate re-crank within interval", async () => {
    let err: any;
    try {
      await program.methods
        .executePayment()
        .accounts({
          schedule: schedulePda,
          escrowTokenAccount: escrowAta,
          recipientTokenAccount: recipientAta,
          cranker: cranker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([cranker])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("IntervalNotElapsed");
  });

  it("a 3rd party (admin) can crank after interval elapses", async () => {
    await sleep(1500); // > 1s interval
    await program.methods
      .executePayment()
      .accounts({
        schedule: schedulePda,
        escrowTokenAccount: escrowAta,
        recipientTokenAccount: recipientAta,
        cranker: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .rpc(); // signs with the provider wallet (admin)

    const s = await program.account.paymentSchedule.fetch(schedulePda);
    expect(s.paymentsMade).to.equal(2);
  });

  it("executes the last payment then errors on next crank", async () => {
    await sleep(1500);
    await program.methods
      .executePayment()
      .accounts({
        schedule: schedulePda,
        escrowTokenAccount: escrowAta,
        recipientTokenAccount: recipientAta,
        cranker: cranker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([cranker])
      .rpc();

    const s = await program.account.paymentSchedule.fetch(schedulePda);
    expect(s.paymentsMade).to.equal(3);
    expect(s.escrowBalance.toString()).to.equal("0");

    await sleep(1500);
    let err: any;
    try {
      await program.methods
        .executePayment()
        .accounts({
          schedule: schedulePda,
          escrowTokenAccount: escrowAta,
          recipientTokenAccount: recipientAta,
          cranker: cranker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([cranker])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("ScheduleComplete");
  });

  it("cancel_schedule refunds remaining escrow + closes the PDA", async () => {
    // Spin up a fresh schedule with leftover funds, then cancel.
    const p = Keypair.generate();
    const r = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      p.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const pAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        p.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      admin.payer,
      rloMint,
      pAta,
      admin.payer,
      BigInt(RLO(1_000).toString())
    );

    const [sched] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("schedule"),
        p.publicKey.toBuffer(),
        r.publicKey.toBuffer(),
      ],
      program.programId
    );
    const esc = getAssociatedTokenAddressSync(rloMint, sched, true);

    // Create with 2 payments of 50 RLO = 100 escrow.
    await program.methods
      .createSchedule(r.publicKey, RLO(50), new BN(60), 2)
      .accounts({
        schedule: sched,
        rloMint,
        escrowTokenAccount: esc,
        payerTokenAccount: pAta,
        recipientAccount: r.publicKey,
        payer: p.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([p])
      .rpc();

    const before = await getAccount(provider.connection, pAta);

    await program.methods
      .cancelSchedule()
      .accounts({
        schedule: sched,
        escrowTokenAccount: esc,
        payerTokenAccount: pAta,
        payer: p.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([p])
      .rpc();

    const after = await getAccount(provider.connection, pAta);
    expect((after.amount - before.amount).toString()).to.equal(
      RLO(100).toString()
    );

    // Schedule PDA closed.
    const accInfo = await provider.connection.getAccountInfo(sched);
    expect(accInfo).to.be.null;
  });
});
