// Nexus Protocol — Lockbox (SafeSend)
//
// Send $RLO to a specific recipient, locked behind a 32-byte claim nonce and
// an expiry timestamp. The recipient claims by signing a tx that presents the
// nonce. If the expiry passes without a claim, the sender can `refund` and
// recover the locked funds.
//
// PDA layout:
//   transfer PDA: seeds = [b"transfer", sender, claim_nonce]
//   escrow ATA  : SPL ATA owned by the transfer PDA, mint = $RLO

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{
    self, CloseAccount, Mint, Token, TokenAccount, Transfer,
};

declare_id!("3x3vj8CQXrbZuajp7g4eq3bUhbzffbhiXX2RC1UfmGhr");

#[program]
pub mod lockbox {
    use super::*;

    /// Sender locks `amount` $RLO into a PDA escrow, claimable by `recipient`
    /// only if they can present `claim_nonce` before `expiry_seconds` elapse.
    pub fn create_transfer(
        ctx: Context<CreateTransfer>,
        recipient: Pubkey,
        amount: u64,
        expiry_seconds: i64,
        claim_nonce: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, LockboxError::ZeroAmount);
        require!(expiry_seconds > 0, LockboxError::InvalidExpiry);

        // Pull tokens into escrow.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sender_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.sender.to_account_info(),
                },
            ),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let transfer_acc = &mut ctx.accounts.transfer;
        transfer_acc.sender = ctx.accounts.sender.key();
        transfer_acc.recipient = recipient;
        transfer_acc.amount = amount;
        transfer_acc.expiry_timestamp = now.saturating_add(expiry_seconds);
        transfer_acc.claimed = false;
        transfer_acc.claim_nonce = claim_nonce;
        transfer_acc.rlo_mint = ctx.accounts.rlo_mint.key();
        transfer_acc.bump = ctx.bumps.transfer;

        emit!(TransferCreated {
            transfer: transfer_acc.key(),
            sender: transfer_acc.sender,
            recipient,
            amount,
            expiry_timestamp: transfer_acc.expiry_timestamp,
        });
        Ok(())
    }

    /// Recipient claims with the matching nonce, before expiry.
    pub fn claim(ctx: Context<Claim>, claim_nonce: [u8; 32]) -> Result<()> {
        // Snapshot infos before &mut.
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let escrow_info = ctx.accounts.escrow_token_account.to_account_info();
        let recipient_token_info = ctx.accounts.recipient_token_account.to_account_info();
        let sender_info = ctx.accounts.sender_account.to_account_info();
        let transfer_info = ctx.accounts.transfer.to_account_info();
        let recipient_info = ctx.accounts.recipient.to_account_info();

        let transfer_acc = &mut ctx.accounts.transfer;
        require!(!transfer_acc.claimed, LockboxError::AlreadyClaimed);
        require_keys_eq!(
            transfer_acc.recipient,
            ctx.accounts.recipient.key(),
            LockboxError::WrongRecipient
        );
        require!(
            transfer_acc.claim_nonce == claim_nonce,
            LockboxError::WrongNonce
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now < transfer_acc.expiry_timestamp, LockboxError::Expired);

        let sender_key = transfer_acc.sender;
        let bump = transfer_acc.bump;
        let nonce_bytes = transfer_acc.claim_nonce;
        let seeds: &[&[u8]] = &[
            b"transfer",
            sender_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from: escrow_info.clone(),
                    to: recipient_token_info,
                    authority: transfer_info.clone(),
                },
                &[seeds],
            ),
            transfer_acc.amount,
        )?;

        // Close empty escrow ATA, return rent lamports to the recipient.
        token::close_account(CpiContext::new_with_signer(
            token_program_info,
            CloseAccount {
                account: escrow_info,
                destination: recipient_info,
                authority: transfer_info,
            },
            &[seeds],
        ))?;

        transfer_acc.claimed = true;

        emit!(TransferClaimed {
            transfer: transfer_acc.key(),
            recipient: transfer_acc.recipient,
            amount: transfer_acc.amount,
            claimed_at: now,
        });

        // Avoid an "unused" warning while keeping the variable named for clarity in CPI sigs.
        let _ = sender_info;
        Ok(())
    }

    /// After expiry, the sender refunds locked tokens back to themselves.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let escrow_info = ctx.accounts.escrow_token_account.to_account_info();
        let sender_token_info = ctx.accounts.sender_token_account.to_account_info();
        let transfer_info = ctx.accounts.transfer.to_account_info();
        let sender_info = ctx.accounts.sender.to_account_info();

        let transfer_acc = &ctx.accounts.transfer;
        require!(!transfer_acc.claimed, LockboxError::AlreadyClaimed);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= transfer_acc.expiry_timestamp, LockboxError::NotYetExpired);

        let sender_key = transfer_acc.sender;
        let bump = transfer_acc.bump;
        let nonce_bytes = transfer_acc.claim_nonce;
        let seeds: &[&[u8]] = &[
            b"transfer",
            sender_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from: escrow_info.clone(),
                    to: sender_token_info,
                    authority: transfer_info.clone(),
                },
                &[seeds],
            ),
            transfer_acc.amount,
        )?;

        token::close_account(CpiContext::new_with_signer(
            token_program_info,
            CloseAccount {
                account: escrow_info,
                destination: sender_info,
                authority: transfer_info,
            },
            &[seeds],
        ))?;

        // Transfer PDA itself closed via `close = sender` on the Accounts struct.

        emit!(TransferRefunded {
            transfer: transfer_acc.key(),
            sender: sender_key,
            amount: transfer_acc.amount,
        });
        Ok(())
    }
}

// ---------- Accounts ----------

#[derive(Accounts)]
#[instruction(recipient: Pubkey, amount: u64, expiry_seconds: i64, claim_nonce: [u8; 32])]
pub struct CreateTransfer<'info> {
    #[account(
        init,
        payer = sender,
        space = 8 + PendingTransfer::INIT_SPACE,
        seeds = [b"transfer", sender.key().as_ref(), claim_nonce.as_ref()],
        bump,
    )]
    pub transfer: Box<Account<'info, PendingTransfer>>,

    pub rlo_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = sender,
        associated_token::mint = rlo_mint,
        associated_token::authority = transfer,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = rlo_mint,
        token::authority = sender,
    )]
    pub sender_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"transfer", transfer.sender.as_ref(), transfer.claim_nonce.as_ref()],
        bump = transfer.bump,
        close = recipient, // close PDA on claim, return rent to recipient
    )]
    pub transfer: Box<Account<'info, PendingTransfer>>,

    #[account(
        mut,
        associated_token::mint = transfer.rlo_mint,
        associated_token::authority = transfer,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = transfer.rlo_mint,
        token::authority = recipient,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    /// Used only so we can pass its AccountInfo for clarity; not a signer.
    /// Address constraint matches the on-chain `transfer.sender`.
    /// CHECK: read-only.
    #[account(address = transfer.sender)]
    pub sender_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub recipient: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [b"transfer", transfer.sender.as_ref(), transfer.claim_nonce.as_ref()],
        bump = transfer.bump,
        has_one = sender,
        close = sender, // close PDA, return rent to sender
    )]
    pub transfer: Box<Account<'info, PendingTransfer>>,

    #[account(
        mut,
        associated_token::mint = transfer.rlo_mint,
        associated_token::authority = transfer,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = transfer.rlo_mint,
        token::authority = sender,
    )]
    pub sender_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ---------- State ----------

#[account]
#[derive(InitSpace)]
pub struct PendingTransfer {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub expiry_timestamp: i64,
    pub claimed: bool,
    pub claim_nonce: [u8; 32],
    pub rlo_mint: Pubkey,
    pub bump: u8,
}

// ---------- Events ----------

#[event]
pub struct TransferCreated {
    pub transfer: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub expiry_timestamp: i64,
}

#[event]
pub struct TransferClaimed {
    pub transfer: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
}

#[event]
pub struct TransferRefunded {
    pub transfer: Pubkey,
    pub sender: Pubkey,
    pub amount: u64,
}

// ---------- Errors ----------

#[error_code]
pub enum LockboxError {
    #[msg("Amount must be > 0.")]
    ZeroAmount,
    #[msg("Expiry seconds must be positive.")]
    InvalidExpiry,
    #[msg("Transfer was already claimed or refunded.")]
    AlreadyClaimed,
    #[msg("Signer is not the designated recipient.")]
    WrongRecipient,
    #[msg("Claim nonce mismatch.")]
    WrongNonce,
    #[msg("Transfer has expired.")]
    Expired,
    #[msg("Transfer has not yet expired.")]
    NotYetExpired,
}
