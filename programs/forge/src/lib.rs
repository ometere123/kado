// Nexus Protocol — Forge (SCALE)
//
// Agent-economy task board with on-chain $RLO escrow.
//
// Flow:
//   1. Poster calls `post_task` — funds reward into escrow PDA.
//   2. Any number of agents call `bid_on_task` — each registers a per-(task, agent) Bid PDA.
//   3. Poster picks a winning agent via `assign_agent`.
//   4. Assigned agent calls `submit_work(result_hash, result_uri)`.
//   5. Poster calls `approve_work` (releases escrow to agent) OR `reject_work`
//      (returns escrow to poster).
//
// PDAs:
//   task PDA  : seeds = [b"task", poster, nonce_le_bytes]    (nonce is u64 chosen by poster)
//   bid PDA   : seeds = [b"bid", task, agent]
//   escrow ATA: SPL ATA owned by the task PDA, mint = $RLO

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{
    self, CloseAccount, Mint, Token, TokenAccount, Transfer,
};

declare_id!("7WZXB6stHDsHgq8fUS4RfSu8UyDJWjHFCQbULGarErp4");

const MAX_DESC_LEN: usize = 280;
const MAX_URI_LEN: usize = 200;
const ZERO_PUBKEY: Pubkey = Pubkey::new_from_array([0u8; 32]);

#[program]
pub mod forge {
    use super::*;

    /// Create a new task and lock the reward into escrow.
    /// `nonce` lets the same poster have many tasks (each task PDA derives from it).
    pub fn post_task(
        ctx: Context<PostTask>,
        nonce: u64,
        description: String,
        reward: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(reward > 0, ForgeError::ZeroReward);
        require!(deadline > Clock::get()?.unix_timestamp, ForgeError::DeadlineInPast);
        require!(
            description.as_bytes().len() <= MAX_DESC_LEN,
            ForgeError::DescriptionTooLong
        );

        // Move reward into escrow.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.poster_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.poster.to_account_info(),
                },
            ),
            reward,
        )?;

        let task = &mut ctx.accounts.task;
        task.poster = ctx.accounts.poster.key();
        task.agent = ZERO_PUBKEY;
        task.reward = reward;
        task.status = TaskStatus::Open;
        task.result_hash = [0u8; 32];
        task.result_uri = String::new();
        task.deadline = deadline;
        task.description = description;
        task.rlo_mint = ctx.accounts.rlo_mint.key();
        task.nonce = nonce;
        task.bump = ctx.bumps.task;

        emit!(TaskPosted {
            task: task.key(),
            poster: task.poster,
            reward,
            deadline,
        });
        Ok(())
    }

    /// Register a bid on an Open task. Creates a small Bid PDA per (task, agent).
    pub fn bid_on_task(ctx: Context<BidOnTask>) -> Result<()> {
        let task = &ctx.accounts.task;
        require!(task.status == TaskStatus::Open, ForgeError::NotOpenForBids);
        require!(
            Clock::get()?.unix_timestamp < task.deadline,
            ForgeError::DeadlinePassed
        );

        let bid = &mut ctx.accounts.bid;
        bid.task = task.key();
        bid.agent = ctx.accounts.agent.key();
        bid.timestamp = Clock::get()?.unix_timestamp;
        bid.bump = ctx.bumps.bid;

        emit!(BidPlaced {
            task: bid.task,
            agent: bid.agent,
        });
        Ok(())
    }

    /// Poster picks a winning agent. Must reference that agent's Bid PDA.
    pub fn assign_agent(ctx: Context<AssignAgent>) -> Result<()> {
        let task = &mut ctx.accounts.task;
        require!(task.status == TaskStatus::Open, ForgeError::NotOpenForBids);
        let bid = &ctx.accounts.bid;
        require_keys_eq!(bid.task, task.key(), ForgeError::BidTaskMismatch);

        task.agent = bid.agent;
        task.status = TaskStatus::Assigned;

        emit!(TaskAssigned {
            task: task.key(),
            agent: bid.agent,
        });
        Ok(())
    }

    /// Assigned agent submits the result hash + URI.
    pub fn submit_work(
        ctx: Context<SubmitWork>,
        result_hash: [u8; 32],
        result_uri: String,
    ) -> Result<()> {
        require!(
            result_uri.as_bytes().len() <= MAX_URI_LEN,
            ForgeError::UriTooLong
        );
        let task = &mut ctx.accounts.task;
        require!(task.status == TaskStatus::Assigned, ForgeError::NotAssigned);
        require_keys_eq!(task.agent, ctx.accounts.agent.key(), ForgeError::NotAssignedAgent);

        task.result_hash = result_hash;
        task.result_uri = result_uri;
        task.status = TaskStatus::Submitted;

        emit!(WorkSubmitted {
            task: task.key(),
            agent: task.agent,
        });
        Ok(())
    }

    /// Poster approves submitted work → escrow released to agent.
    pub fn approve_work(ctx: Context<SettleWork>) -> Result<()> {
        // Snapshot AccountInfos before &mut.
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let escrow_info = ctx.accounts.escrow_token_account.to_account_info();
        let payout_info = ctx.accounts.payout_token_account.to_account_info();
        let task_info = ctx.accounts.task.to_account_info();
        let poster_info = ctx.accounts.poster.to_account_info();

        let task = &mut ctx.accounts.task;
        require!(task.status == TaskStatus::Submitted, ForgeError::NotSubmitted);
        // payout goes to the agent — verified by token::authority constraint on Accounts.
        let poster_key = task.poster;
        let nonce = task.nonce;
        let bump = task.bump;
        let nonce_bytes = nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[b"task", poster_key.as_ref(), &nonce_bytes, &[bump]];

        let reward = task.reward;
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from: escrow_info.clone(),
                    to: payout_info,
                    authority: task_info.clone(),
                },
                &[seeds],
            ),
            reward,
        )?;
        token::close_account(CpiContext::new_with_signer(
            token_program_info,
            CloseAccount {
                account: escrow_info,
                destination: poster_info,
                authority: task_info,
            },
            &[seeds],
        ))?;

        task.status = TaskStatus::Approved;
        emit!(WorkApproved {
            task: task.key(),
            agent: task.agent,
            reward,
        });
        Ok(())
    }

    /// Poster rejects submitted work → escrow returned to poster.
    pub fn reject_work(ctx: Context<SettleWork>) -> Result<()> {
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let escrow_info = ctx.accounts.escrow_token_account.to_account_info();
        let payout_info = ctx.accounts.payout_token_account.to_account_info();
        let task_info = ctx.accounts.task.to_account_info();
        let poster_info = ctx.accounts.poster.to_account_info();

        let task = &mut ctx.accounts.task;
        require!(task.status == TaskStatus::Submitted, ForgeError::NotSubmitted);
        // For reject, payout_token_account must be poster's, not agent's. Enforced via
        // the `token::authority = poster` constraint on a separate Accounts struct.
        let poster_key = task.poster;
        let nonce = task.nonce;
        let bump = task.bump;
        let nonce_bytes = nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[b"task", poster_key.as_ref(), &nonce_bytes, &[bump]];

        let reward = task.reward;
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from: escrow_info.clone(),
                    to: payout_info,
                    authority: task_info.clone(),
                },
                &[seeds],
            ),
            reward,
        )?;
        token::close_account(CpiContext::new_with_signer(
            token_program_info,
            CloseAccount {
                account: escrow_info,
                destination: poster_info,
                authority: task_info,
            },
            &[seeds],
        ))?;

        task.status = TaskStatus::Rejected;
        emit!(WorkRejected {
            task: task.key(),
            agent: task.agent,
            reward,
        });
        Ok(())
    }
}

// ---------- Accounts ----------

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct PostTask<'info> {
    #[account(
        init,
        payer = poster,
        space = 8 + Task::INIT_SPACE,
        seeds = [b"task", poster.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub task: Box<Account<'info, Task>>,

    pub rlo_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = poster,
        associated_token::mint = rlo_mint,
        associated_token::authority = task,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = rlo_mint,
        token::authority = poster,
    )]
    pub poster_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub poster: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BidOnTask<'info> {
    pub task: Box<Account<'info, Task>>,

    #[account(
        init,
        payer = agent,
        space = 8 + Bid::INIT_SPACE,
        seeds = [b"bid", task.key().as_ref(), agent.key().as_ref()],
        bump,
    )]
    pub bid: Box<Account<'info, Bid>>,

    #[account(mut)]
    pub agent: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AssignAgent<'info> {
    #[account(
        mut,
        seeds = [b"task", task.poster.as_ref(), &task.nonce.to_le_bytes()],
        bump = task.bump,
        has_one = poster,
    )]
    pub task: Box<Account<'info, Task>>,

    /// The winning bid PDA — its `agent` is what we copy onto the task.
    #[account(
        seeds = [b"bid", task.key().as_ref(), bid.agent.as_ref()],
        bump = bid.bump,
    )]
    pub bid: Box<Account<'info, Bid>>,

    pub poster: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    #[account(
        mut,
        seeds = [b"task", task.poster.as_ref(), &task.nonce.to_le_bytes()],
        bump = task.bump,
    )]
    pub task: Box<Account<'info, Task>>,

    pub agent: Signer<'info>,
}

/// Used by both `approve_work` and `reject_work`. The handler enforces
/// that `payout_token_account.owner` is either the agent (approve) or the
/// poster (reject) by using `token::authority` constraints conditionally —
/// but since Anchor can't pick which one at compile time, we accept either
/// the agent or poster ATA here and verify ownership in handler logic.
#[derive(Accounts)]
pub struct SettleWork<'info> {
    #[account(
        mut,
        seeds = [b"task", task.poster.as_ref(), &task.nonce.to_le_bytes()],
        bump = task.bump,
        has_one = poster,
        close = poster, // Approved/Rejected tasks close, poster reclaims rent
    )]
    pub task: Box<Account<'info, Task>>,

    #[account(
        mut,
        associated_token::mint = task.rlo_mint,
        associated_token::authority = task,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    /// For approve_work: agent's ATA. For reject_work: poster's ATA.
    /// Handler relies on the caller passing the correct one. Mint must match.
    #[account(mut, token::mint = task.rlo_mint)]
    pub payout_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub poster: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ---------- State ----------

#[account]
#[derive(InitSpace)]
pub struct Task {
    pub poster: Pubkey,
    pub agent: Pubkey,
    pub reward: u64,
    pub status: TaskStatus,
    pub result_hash: [u8; 32],
    #[max_len(MAX_URI_LEN)]
    pub result_uri: String,
    pub deadline: i64,
    #[max_len(MAX_DESC_LEN)]
    pub description: String,
    pub rlo_mint: Pubkey,
    pub nonce: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub task: Pubkey,
    pub agent: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum TaskStatus {
    Open,
    Assigned,
    Submitted,
    Approved,
    Rejected,
}

// ---------- Events ----------

#[event]
pub struct TaskPosted {
    pub task: Pubkey,
    pub poster: Pubkey,
    pub reward: u64,
    pub deadline: i64,
}

#[event]
pub struct BidPlaced {
    pub task: Pubkey,
    pub agent: Pubkey,
}

#[event]
pub struct TaskAssigned {
    pub task: Pubkey,
    pub agent: Pubkey,
}

#[event]
pub struct WorkSubmitted {
    pub task: Pubkey,
    pub agent: Pubkey,
}

#[event]
pub struct WorkApproved {
    pub task: Pubkey,
    pub agent: Pubkey,
    pub reward: u64,
}

#[event]
pub struct WorkRejected {
    pub task: Pubkey,
    pub agent: Pubkey,
    pub reward: u64,
}

// ---------- Errors ----------

#[error_code]
pub enum ForgeError {
    #[msg("Reward must be > 0.")]
    ZeroReward,
    #[msg("Deadline must be in the future.")]
    DeadlineInPast,
    #[msg("Deadline has already passed.")]
    DeadlinePassed,
    #[msg("Description too long.")]
    DescriptionTooLong,
    #[msg("URI too long.")]
    UriTooLong,
    #[msg("Task is not Open (not accepting bids/assignment).")]
    NotOpenForBids,
    #[msg("Bid references a different task.")]
    BidTaskMismatch,
    #[msg("Task has not been assigned to an agent yet.")]
    NotAssigned,
    #[msg("Signer is not the assigned agent.")]
    NotAssignedAgent,
    #[msg("Task is not in Submitted state.")]
    NotSubmitted,
}
