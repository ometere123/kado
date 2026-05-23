// Nexus Protocol — Streamline (recurring payments)
//
// Pre-funded schedule: at creation, the payer transfers
//   amount_per_payment * total_payments  $RLO
// into a PDA escrow. Anyone can crank `execute_payment` once
// `interval_seconds` have elapsed since the last execution; the cranker is
// permissionless so the payer doesn't have to remain online.
//
// PDA layout:
//   schedule PDA: seeds = [b"schedule", payer, recipient]
//   escrow ATA  : SPL ATA owned by the schedule PDA, mint = $RLO
//
// One active schedule per (payer, recipient) pair — cancel & recreate to change terms.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{
    self, CloseAccount, Mint, Token, TokenAccount, Transfer,
};

declare_id!("CXcZSw9VYBWE9UiZ6QyXcNugxLYo4AbtdiPY849CQ767");

#[program]
pub mod streamline {
    use super::*;

    /// Create a new pre-funded payment schedule. Pulls full amount into escrow now.
    pub fn create_schedule(
        ctx: Context<CreateSchedule>,
        recipient: Pubkey,
        amount_per_payment: u64,
        interval_seconds: i64,
        total_payments: u8,
    ) -> Result<()> {
        require!(amount_per_payment > 0, StreamError::ZeroAmount);
        require!(total_payments > 0, StreamError::ZeroPayments);
        require!(interval_seconds > 0, StreamError::InvalidInterval);
        require_keys_eq!(
            ctx.accounts.recipient_account.key(),
            recipient,
            StreamError::RecipientMismatch
        );

        let total = (amount_per_payment as u128)
            .checked_mul(total_payments as u128)
            .ok_or(StreamError::MathOverflow)?;
        let total_u64 = u64::try_from(total).map_err(|_| StreamError::MathOverflow)?;

        // Move full schedule amount into escrow.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            total_u64,
        )?;

        let schedule = &mut ctx.accounts.schedule;
        schedule.payer = ctx.accounts.payer.key();
        schedule.recipient = recipient;
        schedule.amount_per_payment = amount_per_payment;
        schedule.interval_seconds = interval_seconds;
        schedule.payments_made = 0;
        schedule.total_payments = total_payments;
        // Last-executed = creation time minus one interval, so the *first* payment is
        // immediately executable. This is the common convention; if you want a delay,
        // adjust here.
        let now = Clock::get()?.unix_timestamp;
        schedule.last_executed = now.saturating_sub(interval_seconds);
        schedule.escrow_balance = total_u64;
        schedule.bump = ctx.bumps.schedule;
        schedule.rlo_mint = ctx.accounts.rlo_mint.key();

        emit!(ScheduleCreated {
            schedule: schedule.key(),
            payer: schedule.payer,
            recipient,
            amount_per_payment,
            interval_seconds,
            total_payments,
        });
        Ok(())
    }

    /// Permissionless crank. Anyone may call once `interval_seconds` have elapsed.
    pub fn execute_payment(ctx: Context<ExecutePayment>) -> Result<()> {
        // Snapshot AccountInfos before taking &mut on schedule.
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let escrow_info = ctx.accounts.escrow_token_account.to_account_info();
        let recipient_info = ctx.accounts.recipient_token_account.to_account_info();
        let schedule_info = ctx.accounts.schedule.to_account_info();

        let schedule = &mut ctx.accounts.schedule;
        require!(
            schedule.payments_made < schedule.total_payments,
            StreamError::ScheduleComplete
        );

        let now = Clock::get()?.unix_timestamp;
        let next_due = schedule
            .last_executed
            .checked_add(schedule.interval_seconds)
            .ok_or(StreamError::MathOverflow)?;
        require!(now >= next_due, StreamError::IntervalNotElapsed);
        require!(
            schedule.escrow_balance >= schedule.amount_per_payment,
            StreamError::InsufficientEscrow
        );
        // Sanity: recipient_token_account.owner == schedule.recipient is enforced via
        // anchor `token::authority = recipient` constraint on the accounts struct.

        let payer_key = schedule.payer;
        let recipient_key = schedule.recipient;
        let bump = schedule.bump;
        let seeds: &[&[u8]] = &[
            b"schedule",
            payer_key.as_ref(),
            recipient_key.as_ref(),
            &[bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                token_program_info,
                Transfer {
                    from: escrow_info,
                    to: recipient_info,
                    authority: schedule_info,
                },
                &[seeds],
            ),
            schedule.amount_per_payment,
        )?;

        schedule.payments_made = schedule
            .payments_made
            .checked_add(1)
            .ok_or(StreamError::MathOverflow)?;
        schedule.last_executed = now;
        schedule.escrow_balance = schedule
            .escrow_balance
            .checked_sub(schedule.amount_per_payment)
            .ok_or(StreamError::MathOverflow)?;

        emit!(PaymentExecuted {
            schedule: schedule.key(),
            payments_made: schedule.payments_made,
            amount: schedule.amount_per_payment,
            executed_at: now,
        });
        Ok(())
    }

    /// Payer cancels the schedule, recovers any remaining escrow, and closes the PDA.
    pub fn cancel_schedule(ctx: Context<CancelSchedule>) -> Result<()> {
        // Snapshot for CPIs before taking the borrow.
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let escrow_info = ctx.accounts.escrow_token_account.to_account_info();
        let payer_token_info = ctx.accounts.payer_token_account.to_account_info();
        let schedule_info = ctx.accounts.schedule.to_account_info();
        let payer_info = ctx.accounts.payer.to_account_info();

        let schedule = &ctx.accounts.schedule;
        let payer_key = schedule.payer;
        let recipient_key = schedule.recipient;
        let bump = schedule.bump;
        let seeds: &[&[u8]] = &[
            b"schedule",
            payer_key.as_ref(),
            recipient_key.as_ref(),
            &[bump],
        ];

        // Return remaining escrow tokens to payer.
        let remaining = schedule.escrow_balance;
        if remaining > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    token_program_info.clone(),
                    Transfer {
                        from: escrow_info.clone(),
                        to: payer_token_info,
                        authority: schedule_info.clone(),
                    },
                    &[seeds],
                ),
                remaining,
            )?;
        }

        // Close the escrow ATA so its lamports go back to payer.
        token::close_account(CpiContext::new_with_signer(
            token_program_info,
            CloseAccount {
                account: escrow_info,
                destination: payer_info,
                authority: schedule_info,
            },
            &[seeds],
        ))?;

        // The schedule PDA itself is closed via the `close = payer` constraint
        // on the Anchor accounts struct below.

        emit!(ScheduleCancelled {
            payer: payer_key,
            recipient: recipient_key,
            refunded: remaining,
        });
        Ok(())
    }
}

// ---------- Accounts ----------

#[derive(Accounts)]
#[instruction(recipient: Pubkey)]
pub struct CreateSchedule<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + PaymentSchedule::INIT_SPACE,
        seeds = [b"schedule", payer.key().as_ref(), recipient.as_ref()],
        bump,
    )]
    pub schedule: Box<Account<'info, PaymentSchedule>>,

    pub rlo_mint: Box<Account<'info, Mint>>,

    /// Escrow ATA owned by the schedule PDA.
    #[account(
        init,
        payer = payer,
        associated_token::mint = rlo_mint,
        associated_token::authority = schedule,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    /// Payer's source ATA — must already exist.
    #[account(
        mut,
        token::mint = rlo_mint,
        token::authority = payer,
    )]
    pub payer_token_account: Box<Account<'info, TokenAccount>>,

    /// Recipient's destination ATA — passed so we can sanity-check the pubkey at init.
    /// (We don't move tokens here; we just verify the address matches the seed-encoded recipient.)
    /// `address` constraint is enforced inside the handler via `require_keys_eq!`.
    pub recipient_account: SystemAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ExecutePayment<'info> {
    #[account(
        mut,
        seeds = [b"schedule", schedule.payer.as_ref(), schedule.recipient.as_ref()],
        bump = schedule.bump,
    )]
    pub schedule: Box<Account<'info, PaymentSchedule>>,

    #[account(
        mut,
        associated_token::mint = schedule.rlo_mint,
        associated_token::authority = schedule,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    /// Anchor enforces that this token account is owned by the recipient encoded in
    /// the schedule, so an arbitrary cranker can't redirect funds.
    #[account(
        mut,
        token::mint = schedule.rlo_mint,
        token::authority = schedule.recipient,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    /// Anyone can pay for the tx; not a signer over the schedule.
    pub cranker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelSchedule<'info> {
    #[account(
        mut,
        seeds = [b"schedule", schedule.payer.as_ref(), schedule.recipient.as_ref()],
        bump = schedule.bump,
        has_one = payer,
        close = payer,
    )]
    pub schedule: Box<Account<'info, PaymentSchedule>>,

    #[account(
        mut,
        associated_token::mint = schedule.rlo_mint,
        associated_token::authority = schedule,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = schedule.rlo_mint,
        token::authority = payer,
    )]
    pub payer_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ---------- State ----------

#[account]
#[derive(InitSpace)]
pub struct PaymentSchedule {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub amount_per_payment: u64,
    pub interval_seconds: i64,
    pub payments_made: u8,
    pub total_payments: u8,
    pub last_executed: i64,
    pub escrow_balance: u64,
    pub rlo_mint: Pubkey,
    pub bump: u8,
}

// ---------- Events ----------

#[event]
pub struct ScheduleCreated {
    pub schedule: Pubkey,
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub amount_per_payment: u64,
    pub interval_seconds: i64,
    pub total_payments: u8,
}

#[event]
pub struct PaymentExecuted {
    pub schedule: Pubkey,
    pub payments_made: u8,
    pub amount: u64,
    pub executed_at: i64,
}

#[event]
pub struct ScheduleCancelled {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub refunded: u64,
}

// ---------- Errors ----------

#[error_code]
pub enum StreamError {
    #[msg("Amount per payment must be > 0.")]
    ZeroAmount,
    #[msg("total_payments must be > 0.")]
    ZeroPayments,
    #[msg("Interval must be positive (seconds).")]
    InvalidInterval,
    #[msg("Recipient pubkey doesn't match the account provided.")]
    RecipientMismatch,
    #[msg("Schedule has completed all payments.")]
    ScheduleComplete,
    #[msg("Not enough time has elapsed since the last payment.")]
    IntervalNotElapsed,
    #[msg("Escrow balance is too low for the next payment.")]
    InsufficientEscrow,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
}
