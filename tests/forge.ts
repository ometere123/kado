// Forge tests (agent-economy task board).
//
// Coverage:
//   - post_task locks reward in escrow; rejects zero/past-deadline/too-long-desc
//   - bid_on_task creates a Bid PDA; rejects on closed/past-deadline tasks
//   - assign_agent moves status to Assigned and copies agent pubkey from bid
//   - submit_work: only assigned agent, only on Assigned task
//   - approve_work: only poster, releases escrow to agent, closes task PDA
//   - reject_work: only poster, refunds to poster, closes task PDA

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

import { Forge } from "../target/types/forge";

const DECIMALS = 6;
const RLO = (n: number) => new BN(n).mul(new BN(10).pow(new BN(DECIMALS)));

function nonceBuf(n: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function farFuture(deltaSec = 3600): BN {
  return new BN(Math.floor(Date.now() / 1000) + deltaSec);
}

describe("forge", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Forge as Program<Forge>;
  const admin = provider.wallet as anchor.Wallet;

  let rloMint: PublicKey;
  const poster = Keypair.generate();
  const agentA = Keypair.generate();
  const agentB = Keypair.generate();
  let posterAta: PublicKey;
  let agentAAta: PublicKey;

  before(async () => {
    for (const kp of [poster, agentA, agentB]) {
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

    posterAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        poster.publicKey
      )
    ).address;
    agentAAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rloMint,
        agentA.publicKey
      )
    ).address;
    // Ensure agentB has an ATA too (for bidding rent payment + potential payouts).
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rloMint,
      agentB.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      rloMint,
      posterAta,
      admin.payer,
      BigInt(RLO(10_000).toString())
    );
  });

  async function postTask(opts: {
    nonce: number;
    reward: BN;
    deadline: BN;
    description?: string;
  }) {
    const [taskPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("task"), poster.publicKey.toBuffer(), nonceBuf(opts.nonce)],
      program.programId
    );
    const escrowAta = getAssociatedTokenAddressSync(rloMint, taskPda, true);

    await program.methods
      .postTask(
        new BN(opts.nonce),
        opts.description ?? "Build a button",
        opts.reward,
        opts.deadline
      )
      .accounts({
        task: taskPda,
        rloMint,
        escrowTokenAccount: escrowAta,
        posterTokenAccount: posterAta,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([poster])
      .rpc();
    return { taskPda, escrowAta };
  }

  it("posts a task + locks the reward in escrow", async () => {
    const { taskPda, escrowAta } = await postTask({
      nonce: 1,
      reward: RLO(500),
      deadline: farFuture(),
    });

    const t = await (program.account as any).task.fetch(taskPda);
    expect(t.poster.toBase58()).to.equal(poster.publicKey.toBase58());
    expect(t.reward.toString()).to.equal(RLO(500).toString());
    expect(t.status.open !== undefined).to.be.true;

    const esc = await getAccount(provider.connection, escrowAta);
    expect(esc.amount.toString()).to.equal(RLO(500).toString());
  });

  it("rejects zero reward / past deadline / over-long description", async () => {
    let e1: any, e2: any, e3: any;
    try {
      await postTask({ nonce: 100, reward: new BN(0), deadline: farFuture() });
    } catch (e) {
      e1 = e;
    }
    try {
      await postTask({ nonce: 101, reward: RLO(1), deadline: new BN(1) });
    } catch (e) {
      e2 = e;
    }
    try {
      await postTask({
        nonce: 102,
        reward: RLO(1),
        deadline: farFuture(),
        description: "x".repeat(300),
      });
    } catch (e) {
      e3 = e;
    }
    expect(String(e1)).to.include("ZeroReward");
    expect(String(e2)).to.include("DeadlineInPast");
    expect(String(e3)).to.include("DescriptionTooLong");
  });

  it("two agents bid + poster assigns the winner", async () => {
    const { taskPda } = await postTask({
      nonce: 2,
      reward: RLO(200),
      deadline: farFuture(),
    });

    // agentA bids
    const [bidAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bid"), taskPda.toBuffer(), agentA.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .bidOnTask()
      .accounts({
        task: taskPda,
        bid: bidAPda,
        agent: agentA.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentA])
      .rpc();

    // agentB bids
    const [bidBPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bid"), taskPda.toBuffer(), agentB.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .bidOnTask()
      .accounts({
        task: taskPda,
        bid: bidBPda,
        agent: agentB.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentB])
      .rpc();

    // Poster assigns agentA.
    await program.methods
      .assignAgent()
      .accounts({
        task: taskPda,
        bid: bidAPda,
        poster: poster.publicKey,
      } as any)
      .signers([poster])
      .rpc();

    const t = await (program.account as any).task.fetch(taskPda);
    expect(t.agent.toBase58()).to.equal(agentA.publicKey.toBase58());
    expect(t.status.assigned !== undefined).to.be.true;
  });

  it("only assigned agent can submit work; full happy path approve", async () => {
    // Fresh task + assignment via shortcut.
    const { taskPda, escrowAta } = await postTask({
      nonce: 3,
      reward: RLO(150),
      deadline: farFuture(),
    });
    const [bidAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bid"), taskPda.toBuffer(), agentA.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .bidOnTask()
      .accounts({
        task: taskPda,
        bid: bidAPda,
        agent: agentA.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentA])
      .rpc();
    await program.methods
      .assignAgent()
      .accounts({
        task: taskPda,
        bid: bidAPda,
        poster: poster.publicKey,
      } as any)
      .signers([poster])
      .rpc();

    // agentB tries to submit — should fail.
    const fakeHash = Array.from(new Uint8Array(32).fill(0xab));
    let err: any;
    try {
      await program.methods
        .submitWork(fakeHash, "ipfs://Qm-fake")
        .accounts({
          task: taskPda,
          agent: agentB.publicKey,
        } as any)
        .signers([agentB])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("NotAssignedAgent");

    // agentA submits.
    await program.methods
      .submitWork(fakeHash, "ipfs://QmRealCid")
      .accounts({
        task: taskPda,
        agent: agentA.publicKey,
      } as any)
      .signers([agentA])
      .rpc();
    let t = await (program.account as any).task.fetch(taskPda);
    expect(t.status.submitted !== undefined).to.be.true;
    expect(t.resultUri).to.equal("ipfs://QmRealCid");

    // Poster approves → reward goes to agentA.
    const before = await getAccount(provider.connection, agentAAta);
    await program.methods
      .approveWork()
      .accounts({
        task: taskPda,
        escrowTokenAccount: escrowAta,
        payoutTokenAccount: agentAAta,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([poster])
      .rpc();

    const after = await getAccount(provider.connection, agentAAta);
    expect((after.amount - before.amount).toString()).to.equal(
      RLO(150).toString()
    );

    // Task PDA closed.
    const acc = await provider.connection.getAccountInfo(taskPda);
    expect(acc).to.be.null;
  });

  it("reject_work refunds escrow to poster + closes task", async () => {
    const { taskPda, escrowAta } = await postTask({
      nonce: 4,
      reward: RLO(75),
      deadline: farFuture(),
    });
    const [bidAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bid"), taskPda.toBuffer(), agentA.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .bidOnTask()
      .accounts({
        task: taskPda,
        bid: bidAPda,
        agent: agentA.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentA])
      .rpc();
    await program.methods
      .assignAgent()
      .accounts({
        task: taskPda,
        bid: bidAPda,
        poster: poster.publicKey,
      } as any)
      .signers([poster])
      .rpc();
    await program.methods
      .submitWork(Array.from(new Uint8Array(32)), "ipfs://x")
      .accounts({
        task: taskPda,
        agent: agentA.publicKey,
      } as any)
      .signers([agentA])
      .rpc();

    const before = await getAccount(provider.connection, posterAta);
    await program.methods
      .rejectWork()
      .accounts({
        task: taskPda,
        escrowTokenAccount: escrowAta,
        payoutTokenAccount: posterAta,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([poster])
      .rpc();
    const after = await getAccount(provider.connection, posterAta);
    expect((after.amount - before.amount).toString()).to.equal(
      RLO(75).toString()
    );

    const acc = await provider.connection.getAccountInfo(taskPda);
    expect(acc).to.be.null;
  });

  it("rejects bid_on_task once task is Assigned", async () => {
    // Reuse task #2 which is now Assigned.
    const [taskPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("task"), poster.publicKey.toBuffer(), nonceBuf(2)],
      program.programId
    );
    const newcomer = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      newcomer.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
    const [bidPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bid"), taskPda.toBuffer(), newcomer.publicKey.toBuffer()],
      program.programId
    );

    let err: any;
    try {
      await program.methods
        .bidOnTask()
        .accounts({
          task: taskPda,
          bid: bidPda,
          agent: newcomer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([newcomer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(String(err)).to.include("NotOpenForBids");
  });
});
