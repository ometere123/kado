// Nexus Protocol — Collateral Vault
//
// State per user:
//   CollateralVault { owner, staked_amount, borrowed_amount, credit_rating, haircut_bps, last_updated }
//
// Instructions (spec):
//   initialize_treasury()                       -- admin bootstrap, holds the lending pot
//   initialize_vault(credit_rating, haircut_bps)
//   stake(amount)                               -- user RLO -> vault PDA ATA
//   borrow(amount)                              -- treasury PDA ATA -> user RLO, enforces LTV
//   repay(amount)                               -- user RLO -> treasury PDA ATA
//   withdraw(amount)                            -- vault PDA ATA -> user RLO, keeps borrow covered
//
// LTV rule (both borrow and withdraw):
//   borrowed_amount <= staked_amount * haircut_bps / 10000

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("7ReQsccnwt5qe3bcE3G3X7t5qmLMBMqzSMKJqu69eeTj");

const BPS_DENOMINATOR: u128 = 10_000;

#[program]
pub mod vault {
    use super::*;

    /// Admin bootstrap. Creates the program's lending treasury (PDA + its $RLO ATA).
    /// The first signer becomes the admin; they're expected to fund the treasury ATA
    /// via a plain SPL transfer afterwards.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        treasury.admin = ctx.accounts.admin.key();
        treasury.rlo_mint = ctx.accounts.rlo_mint.key();
        treasury.bump = ctx.bumps.treasury;
        emit!(TreasuryInitialized {
            admin: treasury.admin,
            mint: treasury.rlo_mint,
        });
        Ok(())
    }

    /// Open a new collateral vault for the signer.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        credit_rating: u8,
        haircut_bps: u16,
    ) -> Result<()> {
        require!(
            (1..=5).contains(&credit_rating),
            VaultError::InvalidCreditRating
        );
        require!(haircut_bps <= 10_000, VaultError::InvalidHaircut);

        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.staked_amount = 0;
        vault.borrowed_amount = 0;
        vault.credit_rating = credit_rating;
        vault.haircut_bps = haircut_bps;
        vault.last_updated = Clock::get()?.unix_timestamp;
        vault.bump = ctx.bumps.vault;

        emit!(VaultInitialized {
            owner: vault.owner,
            credit_rating,
            haircut_bps,
        });
        Ok(())
    }

    /// Move `amount` $RLO from the owner's ATA into the vault's PDA ATA.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        let vault = &mut ctx.accounts.vault;
        vault.staked_amount = vault
            .staked_amount
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        vault.last_updated = Clock::get()?.unix_timestamp;

        emit!(Staked {
            owner: vault.owner,
            amount,
            new_staked: vault.staked_amount,
        });
        Ok(())
    }

    /// Borrow `amount` $RLO from the treasury, charged against the vault.
    /// Enforces borrowed_amount <= staked_amount * tier_max_ltv / 10000.
    /// Credit tier (1–5) directly determines the maximum LTV.
    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let vault = &mut ctx.accounts.vault;

        // Tier → max LTV (basis points). Higher rating = more capital efficiency.
        let max_ltv_bps: u16 = match vault.credit_rating {
            1 => 4000, // 40%
            2 => 5000, // 50%
            3 => 6000, // 60%
            4 => 7000, // 70%
            5 => 8000, // 80%
            _ => return err!(VaultError::InvalidCreditRating),
        };

        let new_borrowed = vault
            .borrowed_amount
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        let max_borrow = max_borrow_for(vault.staked_amount, max_ltv_bps)?;
        require!(new_borrowed <= max_borrow, VaultError::ExceedsBorrowLimit);

        // Treasury PDA signs the transfer out.
        let treasury_bump = ctx.accounts.treasury.bump;
        let seeds: &[&[u8]] = &[b"treasury", &[treasury_bump]];
        let signer = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury_token_account.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        vault.borrowed_amount = new_borrowed;
        vault.last_updated = Clock::get()?.unix_timestamp;

        emit!(Borrowed {
            owner: vault.owner,
            amount,
            new_borrowed,
        });
        Ok(())
    }

    /// Repay `amount` $RLO from owner's ATA back to the treasury.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let vault = &mut ctx.accounts.vault;
        require!(
            amount <= vault.borrowed_amount,
            VaultError::ExceedsBorrowedAmount
        );

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        vault.borrowed_amount = vault
            .borrowed_amount
            .checked_sub(amount)
            .ok_or(VaultError::MathOverflow)?;
        vault.last_updated = Clock::get()?.unix_timestamp;

        emit!(Repaid {
            owner: vault.owner,
            amount,
            new_borrowed: vault.borrowed_amount,
        });
        Ok(())
    }

    /// Withdraw `amount` $RLO from the vault PDA ATA back to owner.
    /// Enforces that the remaining stake still covers borrowed_amount under haircut.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // Snapshot what we need from the vault account *before* taking &mut on it,
        // because the CPI authority arg below needs an AccountInfo of the same field.
        let owner_key = ctx.accounts.owner.key();
        let vault_account_info = ctx.accounts.vault.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let vault_token_info = ctx.accounts.vault_token_account.to_account_info();
        let owner_token_info = ctx.accounts.owner_token_account.to_account_info();

        let vault = &mut ctx.accounts.vault;
        require!(
            amount <= vault.staked_amount,
            VaultError::ExceedsStakedAmount
        );

        // Mirror the borrow-side tier mapping so withdraw can't bypass the LTV cap.
        let max_ltv_bps: u16 = match vault.credit_rating {
            1 => 4000,
            2 => 5000,
            3 => 6000,
            4 => 7000,
            5 => 8000,
            _ => return err!(VaultError::InvalidCreditRating),
        };

        let new_staked = vault
            .staked_amount
            .checked_sub(amount)
            .ok_or(VaultError::MathOverflow)?;
        let max_borrow_after = max_borrow_for(new_staked, max_ltv_bps)?;
        require!(
            vault.borrowed_amount <= max_borrow_after,
            VaultError::InsufficientCollateral
        );

        let bump = vault.bump;
        let seeds: &[&[u8]] = &[b"vault", owner_key.as_ref(), &[bump]];
        let signer = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            token_program_info,
            Transfer {
                from: vault_token_info,
                to: owner_token_info,
                authority: vault_account_info,
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        vault.staked_amount = new_staked;
        vault.last_updated = Clock::get()?.unix_timestamp;

        emit!(Withdrawn {
            owner: vault.owner,
            amount,
            new_staked,
        });
        Ok(())
    }
}

fn max_borrow_for(staked: u64, haircut_bps: u16) -> Result<u64> {
    let raw = (staked as u128)
        .checked_mul(haircut_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(VaultError::MathOverflow)?;
    u64::try_from(raw).map_err(|_| VaultError::MathOverflow.into())
}

// ---------- Accounts ----------

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Treasury::INIT_SPACE,
        seeds = [b"treasury"],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub rlo_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = rlo_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + CollateralVault::INIT_SPACE,
        seeds = [b"vault", owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, CollateralVault>,

    pub rlo_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = rlo_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub rlo_mint: Account<'info, Mint>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub rlo_mint: Account<'info, Mint>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub rlo_mint: Account<'info, Mint>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = rlo_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub rlo_mint: Account<'info, Mint>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ---------- State ----------

#[account]
#[derive(InitSpace)]
pub struct CollateralVault {
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub borrowed_amount: u64,
    pub credit_rating: u8,
    pub haircut_bps: u16,
    pub last_updated: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub admin: Pubkey,
    pub rlo_mint: Pubkey,
    pub bump: u8,
}

// ---------- Events ----------

#[event]
pub struct TreasuryInitialized {
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct VaultInitialized {
    pub owner: Pubkey,
    pub credit_rating: u8,
    pub haircut_bps: u16,
}

#[event]
pub struct Staked {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_staked: u64,
}

#[event]
pub struct Borrowed {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_borrowed: u64,
}

#[event]
pub struct Repaid {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_borrowed: u64,
}

#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_staked: u64,
}

// ---------- Errors ----------

#[error_code]
pub enum VaultError {
    #[msg("Credit rating must be between 1 and 5.")]
    InvalidCreditRating,
    #[msg("Haircut basis points must be <= 10000.")]
    InvalidHaircut,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Borrow would exceed LTV limit (staked * haircut_bps / 10000).")]
    ExceedsBorrowLimit,
    #[msg("Repay amount exceeds outstanding borrow.")]
    ExceedsBorrowedAmount,
    #[msg("Withdraw amount exceeds staked balance.")]
    ExceedsStakedAmount,
    #[msg("Remaining collateral would not cover outstanding borrow.")]
    InsufficientCollateral,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
}
