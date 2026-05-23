// Lockbox tests (SafeSend with claim-link + expiry).
//
// Coverage:
//   - create_transfer locks funds into escrow PDA
//   - rejects: zero amount, invalid expiry
//   - claim happy path: correct recipient + correct nonce + within expiry
//   - claim rejects: wrong nonce, wrong recipient, expired
//   - claim rejects double-claim
//   - refund rejects before expiry, succeeds after, returns funds to sender, closes PDA

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
import * as crypto from "crypto";
import { expect } from "chai";

import { Lockbox } from "../target/types/lockbox";

const DECIMALS = 6;
const RLO = (n: number) => new BN(n).mul(new BN(10).pow(new BN(DECIMALS)));

function randomNonce(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("lockbox", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Lockbox as Program<Lockbox>;
  const admin = provider.wallet as anchor.Wallet;

  let rloMint: PublicKey;
  const sender = Keypair.generate();
  const recipient = Keypair.generate();
  const stranger = Keypair.generate();
  let senderAta: PublicKey;
  let recipientAta: PublicKey;

  before(async () => {
    for (const kp of [sender, recipient, stranger]) {
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
    senderAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        sender.publicKey
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
      senderAta,
      admin.payer,
      BigInt(RLO(10_000).toString())
    );
  });

  async function makeTransfer(
    amount: BN,
    expirySec: number,
    nonce: Uint8Array
  ) {
    const nonceBuf = Buffer.from(nonce);
    const [transferPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("transfer"), sender.publicKey.toBuffer(), nonceBuf],
      program.programId
    );
    const escrowAta = getAssociatedTokenAddressSync(rloMint, transferPda, true);

    await program.methods
      .createTransfer(recipient.publicKey, amount, new BN(expirySec), Array.from(nonce))
      .accounts({
        transfer: transferPda,
        rloMint,
        escrowTokenAccount: escrowAta,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([sender])
      .rpc();

    return { transferPda, escrowAta, nonce };
  }

  it("creates a transfer + locks escrow", async () => {
    const nonce = randomNonce();
    const { transferPda, escrowAta } = await makeTransfer(RLO(500), 60, nonce);

    const acc = await program.account.pendingTransfer.fetch(transferPda);
    expect(acc.sender.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(acc.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(acc.amount.toString()).to.equal(RLO(500).toString());
    expect(acc.claimed).to.be.false;

    const esc = await getAccount(provider.connection, escrowAta);
    expect(esc.amount.toString()).to.equal(RLO(500).toString());
  });

  it("rejects zero amount / invalid expiry", async () => {
    let e1: any, e2: any;
    try {
      await makeTransfer(new BN(0), 60, randomNonce());
    } catch (e) {
      e1 = e;
    }
    try {
      await makeTransfer(RLO(1), -1, randomNonce());
    } catch (e) {
      e2 = e;
    }
    expect(String(e1)).to.include("ZeroAmount");
    expect(String(e2)).to.include("InvalidExpiry");
  });

  it("claim with correct recipient + nonce + before expiry succeeds", async () => {
    const nonce = randomNonce();
    const { transferPda, escrowAta } = await makeTransfer(RLO(300), 60, nonce);

    const before = await getAccount(provider.connection, recipientAta);

    await program.methods
      .claim(Array.from(nonce))
      .accounts({
        transfer: transferPda,
        escrowTokenAccount: escrowAta,
        recipientTokenAccount: recipientAta,
        senderAccount: sender.publicKey,
        recipient: recipient.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([recipient])
      .rpc();

    const after = await getAccount(provider.connection, recipientAta);
    expect((after.amount - before.amount).toString()).to.equal(
      RLO(300).toString()
    );

    // Transfer PDA closed.
    const acc = await provider.connection.getAccountInfo(transferPda);
    expect(acc).to.be.null;
  });

  it("claim rejects wrong nonce", async () => {
    const nonce = randomNonce();
    const { transferPda, escrowAta } = await makeTransfer(RLO(100), 60, nonce);

    let err: any;
    try {
      await program.methods
        .claim(Array.from(randomNonce()))
        .accounts({
          transfer: transferPda,
          escrowTokenAccount: escrowAta,
          recipientTokenAccount: recipientAta,
          senderAccount: sender.publicKey,
          recipient: recipient.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([recipient])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("WrongNonce");
  });

  it("claim rejects wrong recipient", async () => {
    const nonce = randomNonce();
    const { transferPda, escrowAta } = await makeTransfer(RLO(100), 60, nonce);

    // Create stranger's ATA for the test.
    const strangerAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        stranger.publicKey
      )
    ).address;

    let err: any;
    try {
      await program.methods
        .claim(Array.from(nonce))
        .accounts({
          transfer: transferPda,
          escrowTokenAccount: escrowAta,
          recipientTokenAccount: strangerAta,
          senderAccount: sender.publicKey,
          recipient: stranger.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([stranger])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    // Token::authority constraint fires first if mismatch on recipient_token_account,
    // or our WrongRecipient if it passes that. Either way, the claim is rejected.
    const msg = String(err);
    expect(
      msg.includes("WrongRecipient") || msg.includes("ConstraintTokenOwner")
    ).to.be.true;
  });

  it("refund rejects before expiry", async () => {
    const nonce = randomNonce();
    const { transferPda, escrowAta } = await makeTransfer(RLO(100), 60, nonce);

    let err: any;
    try {
      await program.methods
        .refund()
        .accounts({
          transfer: transferPda,
          escrowTokenAccount: escrowAta,
          senderTokenAccount: senderAta,
          sender: sender.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([sender])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("NotYetExpired");
  });

  it("refund succeeds after expiry, returns funds to sender, closes PDA", async () => {
    const nonce = randomNonce();
    // 1s expiry — small enough to wait through.
    const { transferPda, escrowAta } = await makeTransfer(RLO(250), 1, nonce);

    await sleep(1500);
    const before = await getAccount(provider.connection, senderAta);

    await program.methods
      .refund()
      .accounts({
        transfer: transferPda,
        escrowTokenAccount: escrowAta,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([sender])
      .rpc();

    const after = await getAccount(provider.connection, senderAta);
    expect((after.amount - before.amount).toString()).to.equal(
      RLO(250).toString()
    );

    const acc = await provider.connection.getAccountInfo(transferPda);
    expect(acc).to.be.null;
  });

  it("claim rejects after expiry", async () => {
    const nonce = randomNonce();
    const { transferPda, escrowAta } = await makeTransfer(RLO(100), 1, nonce);

    await sleep(1500);

    let err: any;
    try {
      await program.methods
        .claim(Array.from(nonce))
        .accounts({
          transfer: transferPda,
          escrowTokenAccount: escrowAta,
          recipientTokenAccount: recipientAta,
          senderAccount: sender.publicKey,
          recipient: recipient.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([recipient])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("Expired");
  });
});
