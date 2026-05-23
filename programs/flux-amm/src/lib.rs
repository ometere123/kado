// Nexus Protocol — Flux AMM
//
// Constant-product (x * y = k) liquidity pool with SPL LP shares and a configurable
// fee tier in basis points.
//
// Accounts (PDAs):
//   pool       : seeds [b"pool", mint_a, mint_b]
//   lp_mint    : seeds [b"lp_mint", pool.key()]
//
// State:
//   AmmPool {
//     mint_a, mint_b, token_a_reserve, token_b_reserve,
//     lp_mint, lp_supply, fee_bps, bump,
//   }
//
// Instructions (spec):
//   initialize_pool(fee_bps)
//   add_liquidity(amount_a, amount_b)
//   remove_liquidity(lp_amount)
//   swap(amount_in, min_amount_out, a_to_b)
//
// Invariants:
//   - token_a_reserve / token_b_reserve mirror the on-chain pool ATAs.
//   - x * y = k preserved across swaps (modulo fee growth which lifts k).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{
    self, Burn, Mint, MintTo, Token, TokenAccount, Transfer,
};

declare_id!("528sS3JkYnhruKWxK4n1mZNJqrVY4qLoRkjmV6D9inVW");

const BPS_DENOMINATOR: u128 = 10_000;
/// Initial LP tokens locked into the pool (Uniswap V2 style) to defend against
/// the empty-pool inflation attack.
const MIN_LIQUIDITY: u128 = 1_000;

#[program]
pub mod flux_amm {
    use super::*;

    /// One-shot bootstrap: create the pool PDA, LP mint, and the pool's two token ATAs.
    pub fn initialize_pool(ctx: Context<InitializePool>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 1_000, AmmError::InvalidFee); // cap at 10%
        require_keys_neq!(
            ctx.accounts.mint_a.key(),
            ctx.accounts.mint_b.key(),
            AmmError::IdenticalMints
        );

        let pool = &mut ctx.accounts.pool;
        pool.mint_a = ctx.accounts.mint_a.key();
        pool.mint_b = ctx.accounts.mint_b.key();
        pool.token_a_reserve = 0;
        pool.token_b_reserve = 0;
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.lp_supply = 0;
        pool.fee_bps = fee_bps;
        pool.bump = ctx.bumps.pool;

        emit!(PoolInitialized {
            pool: pool.key(),
            mint_a: pool.mint_a,
            mint_b: pool.mint_b,
            lp_mint: pool.lp_mint,
            fee_bps,
        });
        Ok(())
    }

    /// Deposit tokens into the pool. First deposit defines the price.
    /// Subsequent deposits must respect the existing ratio.
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        require!(amount_a > 0 && amount_b > 0, AmmError::ZeroAmount);

        // Snapshot AccountInfos before taking &mut on ctx.accounts.pool.
        let pool_info = ctx.accounts.pool.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let user_token_a_info = ctx.accounts.user_token_a.to_account_info();
        let user_token_b_info = ctx.accounts.user_token_b.to_account_info();
        let pool_token_a_info = ctx.accounts.pool_token_a.to_account_info();
        let pool_token_b_info = ctx.accounts.pool_token_b.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let lp_mint_info = ctx.accounts.lp_mint.to_account_info();
        let user_lp_info = ctx.accounts.user_lp_account.to_account_info();

        let pool = &mut ctx.accounts.pool;
        let (reserve_a, reserve_b, lp_supply) = (
            pool.token_a_reserve as u128,
            pool.token_b_reserve as u128,
            pool.lp_supply as u128,
        );

        let (final_a, final_b, lp_minted) = if lp_supply == 0 {
            // First deposit. LP minted = sqrt(a * b), with MIN_LIQUIDITY locked.
            let prod = (amount_a as u128)
                .checked_mul(amount_b as u128)
                .ok_or(AmmError::MathOverflow)?;
            let lp_raw = isqrt(prod);
            require!(lp_raw > MIN_LIQUIDITY, AmmError::InsufficientInitialLiquidity);
            let lp_to_user = lp_raw
                .checked_sub(MIN_LIQUIDITY)
                .ok_or(AmmError::MathOverflow)?;
            // Treat MIN_LIQUIDITY as permanently locked: we account for it in lp_supply
            // but never mint it (LP tokens for the locked share don't exist on-chain).
            (amount_a, amount_b, lp_to_user)
        } else {
            // Existing reserves — accept the ratio that the *smaller* side pins down,
            // and only pull that proportional amount from the other side.
            let lp_from_a = (amount_a as u128)
                .checked_mul(lp_supply)
                .ok_or(AmmError::MathOverflow)?
                / reserve_a;
            let lp_from_b = (amount_b as u128)
                .checked_mul(lp_supply)
                .ok_or(AmmError::MathOverflow)?
                / reserve_b;
            let lp_minted = lp_from_a.min(lp_from_b);
            require!(lp_minted > 0, AmmError::ZeroLiquidity);

            // Recompute the actual deposit so the pool stays exactly on-ratio.
            let need_a = lp_minted
                .checked_mul(reserve_a)
                .ok_or(AmmError::MathOverflow)?
                / lp_supply;
            let need_b = lp_minted
                .checked_mul(reserve_b)
                .ok_or(AmmError::MathOverflow)?
                / lp_supply;
            (
                u64::try_from(need_a).map_err(|_| AmmError::MathOverflow)?,
                u64::try_from(need_b).map_err(|_| AmmError::MathOverflow)?,
                lp_minted,
            )
        };

        // Transfer A & B from LP -> pool.
        token::transfer(
            CpiContext::new(
                token_program_info.clone(),
                Transfer {
                    from: user_token_a_info,
                    to: pool_token_a_info,
                    authority: user_info.clone(),
                },
            ),
            final_a,
        )?;
        token::transfer(
            CpiContext::new(
                token_program_info.clone(),
                Transfer {
                    from: user_token_b_info,
                    to: pool_token_b_info,
                    authority: user_info,
                },
            ),
            final_b,
        )?;

        // Mint LP shares to user, pool PDA signs.
        let mint_a_key = pool.mint_a;
        let mint_b_key = pool.mint_b;
        let bump = pool.bump;
        let seeds: &[&[u8]] = &[
            b"pool",
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[bump],
        ];
        let lp_to_mint = u64::try_from(lp_minted).map_err(|_| AmmError::MathOverflow)?;
        token::mint_to(
            CpiContext::new_with_signer(
                token_program_info,
                MintTo {
                    mint: lp_mint_info,
                    to: user_lp_info,
                    authority: pool_info,
                },
                &[seeds],
            ),
            lp_to_mint,
        )?;

        // Update bookkeeping. On first deposit we include MIN_LIQUIDITY in lp_supply
        // (locked, unmintable) to keep the formula honest.
        pool.token_a_reserve = pool
            .token_a_reserve
            .checked_add(final_a)
            .ok_or(AmmError::MathOverflow)?;
        pool.token_b_reserve = pool
            .token_b_reserve
            .checked_add(final_b)
            .ok_or(AmmError::MathOverflow)?;
        if lp_supply == 0 {
            pool.lp_supply = u64::try_from(
                (lp_minted)
                    .checked_add(MIN_LIQUIDITY)
                    .ok_or(AmmError::MathOverflow)?,
            )
            .map_err(|_| AmmError::MathOverflow)?;
        } else {
            pool.lp_supply = pool
                .lp_supply
                .checked_add(lp_to_mint)
                .ok_or(AmmError::MathOverflow)?;
        }

        emit!(LiquidityAdded {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            amount_a: final_a,
            amount_b: final_b,
            lp_minted: lp_to_mint,
        });
        Ok(())
    }

    /// Burn LP shares for a pro-rata claim on reserves.
    pub fn remove_liquidity(ctx: Context<RemoveLiquidity>, lp_amount: u64) -> Result<()> {
        require!(lp_amount > 0, AmmError::ZeroAmount);

        let pool_info = ctx.accounts.pool.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let lp_mint_info = ctx.accounts.lp_mint.to_account_info();
        let user_lp_info = ctx.accounts.user_lp_account.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let pool_token_a_info = ctx.accounts.pool_token_a.to_account_info();
        let pool_token_b_info = ctx.accounts.pool_token_b.to_account_info();
        let user_token_a_info = ctx.accounts.user_token_a.to_account_info();
        let user_token_b_info = ctx.accounts.user_token_b.to_account_info();

        let pool = &mut ctx.accounts.pool;
        let lp_supply = pool.lp_supply as u128;
        require!(lp_supply > 0, AmmError::EmptyPool);

        let amount_a = (lp_amount as u128)
            .checked_mul(pool.token_a_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            / lp_supply;
        let amount_b = (lp_amount as u128)
            .checked_mul(pool.token_b_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            / lp_supply;
        require!(amount_a > 0 && amount_b > 0, AmmError::ZeroLiquidity);

        let amount_a_u64 = u64::try_from(amount_a).map_err(|_| AmmError::MathOverflow)?;
        let amount_b_u64 = u64::try_from(amount_b).map_err(|_| AmmError::MathOverflow)?;

        // Burn LP from user.
        token::burn(
            CpiContext::new(
                token_program_info.clone(),
                Burn {
                    mint: lp_mint_info,
                    from: user_lp_info,
                    authority: user_info,
                },
            ),
            lp_amount,
        )?;

        // Transfer reserves out, pool PDA signs.
        let mint_a_key = pool.mint_a;
        let mint_b_key = pool.mint_b;
        let bump = pool.bump;
        let seeds: &[&[u8]] = &[
            b"pool",
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from: pool_token_a_info,
                    to: user_token_a_info,
                    authority: pool_info.clone(),
                },
                &[seeds],
            ),
            amount_a_u64,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info,
                Transfer {
                    from: pool_token_b_info,
                    to: user_token_b_info,
                    authority: pool_info,
                },
                &[seeds],
            ),
            amount_b_u64,
        )?;

        pool.token_a_reserve = pool
            .token_a_reserve
            .checked_sub(amount_a_u64)
            .ok_or(AmmError::MathOverflow)?;
        pool.token_b_reserve = pool
            .token_b_reserve
            .checked_sub(amount_b_u64)
            .ok_or(AmmError::MathOverflow)?;
        pool.lp_supply = pool
            .lp_supply
            .checked_sub(lp_amount)
            .ok_or(AmmError::MathOverflow)?;

        emit!(LiquidityRemoved {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            amount_a: amount_a_u64,
            amount_b: amount_b_u64,
            lp_burned: lp_amount,
        });
        Ok(())
    }

    /// Constant-product swap with a basis-point fee on the input.
    /// a_to_b = true means user supplies token A, receives token B.
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        require!(amount_in > 0, AmmError::ZeroAmount);

        let pool_info = ctx.accounts.pool.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let pool_token_a_info = ctx.accounts.pool_token_a.to_account_info();
        let pool_token_b_info = ctx.accounts.pool_token_b.to_account_info();
        let user_token_in_info = ctx.accounts.user_token_in.to_account_info();
        let user_token_out_info = ctx.accounts.user_token_out.to_account_info();

        let pool = &mut ctx.accounts.pool;
        let (reserve_in, reserve_out) = if a_to_b {
            (pool.token_a_reserve as u128, pool.token_b_reserve as u128)
        } else {
            (pool.token_b_reserve as u128, pool.token_a_reserve as u128)
        };
        require!(reserve_in > 0 && reserve_out > 0, AmmError::EmptyPool);

        let fee = pool.fee_bps as u128;
        let amount_in_with_fee = (amount_in as u128)
            .checked_mul(BPS_DENOMINATOR - fee)
            .ok_or(AmmError::MathOverflow)?;
        let numerator = amount_in_with_fee
            .checked_mul(reserve_out)
            .ok_or(AmmError::MathOverflow)?;
        let denominator = reserve_in
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(AmmError::MathOverflow)?
            .checked_add(amount_in_with_fee)
            .ok_or(AmmError::MathOverflow)?;
        let amount_out = numerator / denominator;
        let amount_out_u64 = u64::try_from(amount_out).map_err(|_| AmmError::MathOverflow)?;
        require!(amount_out_u64 >= min_amount_out, AmmError::SlippageExceeded);
        require!(amount_out_u64 > 0, AmmError::ZeroOutput);

        let mint_a_key = pool.mint_a;
        let mint_b_key = pool.mint_b;
        let bump = pool.bump;
        let seeds: &[&[u8]] = &[
            b"pool",
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[bump],
        ];

        if a_to_b {
            // user A -> pool, pool B -> user.
            token::transfer(
                CpiContext::new(
                    token_program_info.clone(),
                    Transfer {
                        from: user_token_in_info,
                        to: pool_token_a_info,
                        authority: user_info,
                    },
                ),
                amount_in,
            )?;
            token::transfer(
                CpiContext::new_with_signer(
                    token_program_info,
                    Transfer {
                        from: pool_token_b_info,
                        to: user_token_out_info,
                        authority: pool_info,
                    },
                    &[seeds],
                ),
                amount_out_u64,
            )?;
            pool.token_a_reserve = pool
                .token_a_reserve
                .checked_add(amount_in)
                .ok_or(AmmError::MathOverflow)?;
            pool.token_b_reserve = pool
                .token_b_reserve
                .checked_sub(amount_out_u64)
                .ok_or(AmmError::MathOverflow)?;
        } else {
            // user B -> pool, pool A -> user.
            token::transfer(
                CpiContext::new(
                    token_program_info.clone(),
                    Transfer {
                        from: user_token_in_info,
                        to: pool_token_b_info,
                        authority: user_info,
                    },
                ),
                amount_in,
            )?;
            token::transfer(
                CpiContext::new_with_signer(
                    token_program_info,
                    Transfer {
                        from: pool_token_a_info,
                        to: user_token_out_info,
                        authority: pool_info,
                    },
                    &[seeds],
                ),
                amount_out_u64,
            )?;
            pool.token_b_reserve = pool
                .token_b_reserve
                .checked_add(amount_in)
                .ok_or(AmmError::MathOverflow)?;
            pool.token_a_reserve = pool
                .token_a_reserve
                .checked_sub(amount_out_u64)
                .ok_or(AmmError::MathOverflow)?;
        }

        emit!(Swapped {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            a_to_b,
            amount_in,
            amount_out: amount_out_u64,
        });
        Ok(())
    }
}

// ---------- helpers ----------

/// Integer square root via Newton's method. Pure no_std u128 arithmetic.
fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

// ---------- Accounts ----------

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + AmmPool::INIT_SPACE,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, AmmPool>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    /// LP token mint with the pool PDA as mint authority.
    #[account(
        init,
        payer = admin,
        seeds = [b"lp_mint", pool.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = pool,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_a,
        associated_token::authority = pool,
    )]
    pub pool_token_a: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_b,
        associated_token::authority = pool,
    )]
    pub pool_token_b: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, AmmPool>>,

    #[account(mut, address = pool.lp_mint)]
    pub lp_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = pool.mint_a,
        associated_token::authority = pool,
    )]
    pub pool_token_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pool.mint_b,
        associated_token::authority = pool,
    )]
    pub pool_token_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.mint_a, token::authority = user)]
    pub user_token_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.mint_b, token::authority = user)]
    pub user_token_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = lp_mint, token::authority = user)]
    pub user_lp_account: Box<Account<'info, TokenAccount>>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, AmmPool>>,

    #[account(mut, address = pool.lp_mint)]
    pub lp_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = pool.mint_a,
        associated_token::authority = pool,
    )]
    pub pool_token_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pool.mint_b,
        associated_token::authority = pool,
    )]
    pub pool_token_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.mint_a, token::authority = user)]
    pub user_token_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.mint_b, token::authority = user)]
    pub user_token_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = lp_mint, token::authority = user)]
    pub user_lp_account: Box<Account<'info, TokenAccount>>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, AmmPool>>,

    #[account(
        mut,
        associated_token::mint = pool.mint_a,
        associated_token::authority = pool,
    )]
    pub pool_token_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pool.mint_b,
        associated_token::authority = pool,
    )]
    pub pool_token_b: Box<Account<'info, TokenAccount>>,

    /// User's token-in account. Mint must match swap direction (A if a_to_b, else B).
    #[account(mut, token::authority = user)]
    pub user_token_in: Box<Account<'info, TokenAccount>>,

    /// User's token-out account. Mint must match swap direction (B if a_to_b, else A).
    #[account(mut, token::authority = user)]
    pub user_token_out: Box<Account<'info, TokenAccount>>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ---------- State ----------

#[account]
#[derive(InitSpace)]
pub struct AmmPool {
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub token_a_reserve: u64,
    pub token_b_reserve: u64,
    pub lp_mint: Pubkey,
    pub lp_supply: u64,
    pub fee_bps: u16,
    pub bump: u8,
}

// ---------- Events ----------

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub lp_mint: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct LiquidityAdded {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_minted: u64,
}

#[event]
pub struct LiquidityRemoved {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_burned: u64,
}

#[event]
pub struct Swapped {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub a_to_b: bool,
    pub amount_in: u64,
    pub amount_out: u64,
}

// ---------- Errors ----------

#[error_code]
pub enum AmmError {
    #[msg("Fee basis points exceeds 1000 (10%).")]
    InvalidFee,
    #[msg("Pool mints must differ.")]
    IdenticalMints,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Computed liquidity is zero.")]
    ZeroLiquidity,
    #[msg("Computed output is zero.")]
    ZeroOutput,
    #[msg("Initial deposit must produce more than MIN_LIQUIDITY LP units.")]
    InsufficientInitialLiquidity,
    #[msg("Pool has no reserves.")]
    EmptyPool,
    #[msg("Output below min_amount_out — slippage exceeded.")]
    SlippageExceeded,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
}
