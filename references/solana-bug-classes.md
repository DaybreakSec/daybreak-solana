# Solana Vulnerability Taxonomy

A comprehensive reference of Solana-specific vulnerability classes organized into five domains for specialized security analysis. Each domain maps to a dedicated audit agent that goes deep on its bug classes.

---

## Domain 1: Accounts and Access Control

### 1.1 Missing Signer Checks

**Description**: Instruction handler does not verify that an expected authority account has signed the transaction. Anyone can call the instruction impersonating the authority.

**What to look for**: `AccountInfo` used for authority without `is_signer` check; Anchor accounts missing `Signer<'info>` type or `#[account(signer)]` constraint.

**Vulnerable**:
```rust
// Native: authority never checked for signing
pub fn process_withdraw(accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let authority = next_account_info(accounts)?;
    let vault = next_account_info(accounts)?;
    // Missing: if !authority.is_signer { return Err(...) }
    transfer_from_vault(vault, authority, amount)?;
    Ok(())
}
```

**Secure**:
```rust
pub fn process_withdraw(accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let authority = next_account_info(accounts)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    // ...
}

// Anchor: use Signer type
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub vault: Account<'info, Vault>,
}
```

**Severity**: Critical | **Detection**: Script-detectable (ast-grep: AccountInfo without nearby is_signer)

---

### 1.2 Missing Owner Validation

**Description**: Account data deserialized without verifying the account's owner program. Attacker creates a fake account with matching data layout but owned by a different program.

**What to look for**: `account.data.borrow()` without checking `account.owner`; raw Borsh deserialization on untrusted accounts.

**Vulnerable**:
```rust
let data = vault_account.data.borrow();
let vault: Vault = Vault::try_from_slice(&data)?;
// Attacker can create an account owned by System Program with
// arbitrary data matching Vault layout
```

**Secure**:
```rust
if vault_account.owner != program_id {
    return Err(ProgramError::IncorrectProgramId);
}
let vault: Vault = Vault::try_from_slice(&vault_account.data.borrow())?;

// Anchor: Account<'info, T> checks owner automatically
#[account]
pub struct Vault { pub balance: u64 }
```

**Severity**: Critical | **Detection**: Script-detectable for native; Anchor's `Account<T>` handles automatically

---

### 1.3 Discriminator Confusion (Type Cosplay)

**Description**: Program deserializes account data without checking a discriminator/type tag. An account of type A can be passed where type B is expected if their data layouts are compatible.

**What to look for**: Native programs without type tag bytes at the start of account data; deserialization that doesn't validate a magic number or discriminator.

**Vulnerable**:
```rust
// Both Pool and Vault start with a u64 field
pub struct Pool { pub total_liquidity: u64, pub fee_rate: u64 }
pub struct Vault { pub balance: u64, pub authority: Pubkey }
// A Pool account can be passed where Vault is expected
let vault: Vault = Vault::try_from_slice(&account.data.borrow())?;
// vault.balance = pool.total_liquidity, vault.authority = garbage
```

**Secure**:
```rust
#[repr(u8)]
pub enum AccountTag { Pool = 1, Vault = 2 }
pub struct Vault { pub tag: u8, pub balance: u64, pub authority: Pubkey }

let data = account.data.borrow();
if data[0] != AccountTag::Vault as u8 {
    return Err(ProgramError::InvalidAccountData);
}

// Anchor: 8-byte discriminator added automatically by #[account]
```

**Severity**: Critical | **Detection**: Script-detectable (check for discriminator validation)

---

### 1.4 Reinitialization Attacks

**Description**: Account initialization does not check if the account is already initialized. Attacker re-initializes to overwrite legitimate state (authority, balances).

**What to look for**: `init_if_needed` without reinit guard; native init missing `is_initialized` check.

**Vulnerable**:
```rust
// Native: no initialization check
pub fn initialize(accounts: &[AccountInfo], authority: Pubkey) -> ProgramResult {
    let state = next_account_info(accounts)?;
    let mut data = state.data.borrow_mut();
    let config = Config { authority, is_initialized: true };
    config.serialize(&mut *data)?; // Overwrites existing data!
    Ok(())
}

// Anchor: init_if_needed without guard
#[derive(Accounts)]
pub struct Init<'info> {
    #[account(init_if_needed, payer = user, space = 8 + Config::LEN)]
    pub config: Account<'info, Config>,
}
```

**Secure**:
```rust
// Native: check is_initialized
let config = Config::try_from_slice(&state.data.borrow())?;
if config.is_initialized {
    return Err(ProgramError::AccountAlreadyInitialized);
}

// Anchor: use init (not init_if_needed), or add reinit guard
#[derive(Accounts)]
pub struct Init<'info> {
    #[account(init, payer = user, space = 8 + Config::LEN)]
    pub config: Account<'info, Config>,
}
```

**Severity**: High | **Detection**: Script-detectable (flag init_if_needed, check for is_initialized)

---

### 1.5 Cross-Account Relationship Failures

**Description**: Instruction accepts accounts that should be related (vault belongs to pool, mint matches token account) but doesn't verify the relationship. Attacker substitutes their own vault/mint.

**What to look for**: Missing `has_one` in Anchor; missing key comparisons in native.

**Vulnerable**:
```rust
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // vault_token_account could belong to a different pool!
    token::transfer(ctx.accounts.transfer_ctx(), amount)?;
    Ok(())
}
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>, // No relationship check
}
```

**Secure**:
```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(has_one = vault_token_account)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
}
```

**Severity**: Critical | **Detection**: Requires reasoning (must understand which accounts should relate)

---

### 1.6 Writable Flag Misuse

**Description**: Account mutability not properly enforced. An account that should be read-only is mutable, or an account that must be written is not marked mutable.

**Vulnerable**:
```rust
// Anchor: missing mut on account that gets modified
#[derive(Accounts)]
pub struct Update<'info> {
    pub config: Account<'info, Config>, // Missing #[account(mut)]
}
pub fn update(ctx: Context<Update>, new_fee: u64) -> Result<()> {
    ctx.accounts.config.fee = new_fee; // Write silently fails!
    Ok(())
}
```

**Severity**: Medium-High | **Detection**: Script-detectable

---

### 1.7 PDA Canonical Bump Bypass

**Description**: Program accepts user-supplied bump seed instead of deriving/storing the canonical bump. Attacker can use a non-canonical bump to create a different PDA for the same logical address.

**What to look for**: Bump passed as instruction data; `create_program_address` without stored bump.

**Vulnerable**:
```rust
pub fn verify_pda(accounts: &[AccountInfo], bump: u8) -> ProgramResult {
    let expected = Pubkey::create_program_address(
        &[b"vault", &[bump]], // User-supplied bump!
        program_id,
    )?;
    if pda_account.key != &expected { return Err(...); }
    Ok(())
}
```

**Secure**:
```rust
// Store canonical bump at init, reuse on subsequent calls
let (expected, canonical_bump) = Pubkey::find_program_address(
    &[b"vault"], program_id,
);
vault.bump = canonical_bump; // Store in account data

// Later: use stored bump
let expected = Pubkey::create_program_address(
    &[b"vault", &[vault.bump]], program_id,
)?;

// Anchor: seeds + bump constraint handles this
#[account(seeds = [b"vault"], bump = vault.bump)]
pub vault: Account<'info, Vault>,
```

**Severity**: High | **Detection**: Script-detectable (find create_program_address with instruction data bumps)

---

### 1.8 PDA Seed Collision / Ambiguity

**Description**: Different logical entities derive to the same PDA due to insufficient seed uniqueness, or different PDA types share overlapping seed patterns.

**What to look for**: Seeds without distinguishing components; same prefix for different purposes; variable-length seeds without length delimiters.

**Vulnerable**:
```rust
// User "ab" + pool "cd" has same seeds as user "abc" + pool "d"
let (pda, _) = Pubkey::find_program_address(
    &[user_name.as_bytes(), pool_name.as_bytes()],
    program_id,
);
```

**Secure**:
```rust
// Use fixed-size keys or length-prefixed seeds
let (pda, _) = Pubkey::find_program_address(
    &[b"user_pool", user.key().as_ref(), pool.key().as_ref()],
    program_id,
);
```

**Severity**: High | **Detection**: Requires reasoning (analyze seed structures across program)

---

### 1.9 PDA Scope Leakage

**Description**: PDA seeds don't include a user/pool identifier, allowing cross-user or cross-pool access. User A can operate on User B's PDA.

**Vulnerable**:
```rust
// Global vault PDA - any user can access
let (vault_pda, _) = Pubkey::find_program_address(
    &[b"vault"], program_id,
);
```

**Secure**:
```rust
// User-scoped vault PDA
let (vault_pda, _) = Pubkey::find_program_address(
    &[b"vault", user.key().as_ref()], program_id,
);
```

**Severity**: Critical | **Detection**: Requires reasoning (must understand intended scope)

---

### 1.10 Missing Authority Validation

**Description**: Authority account is accepted but never compared to the stored/expected authority pubkey.

**Vulnerable**:
```rust
pub fn admin_action(ctx: Context<Admin>) -> Result<()> {
    // ctx.accounts.authority is a Signer, but never checked against config.authority
    do_admin_thing()?;
    Ok(())
}
```

**Secure**:
```rust
#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}
```

**Severity**: Critical | **Detection**: Partially script-detectable

---

### 1.11 Permissionless Initialization Frontrunning

**Description**: Init instruction callable by anyone. Attacker frontruns to set malicious initial state (wrong authority, bad parameters).

**What to look for**: Permissionless init without fixed authority; no access control on initialization.

**Severity**: High | **Detection**: Requires reasoning

---

### 1.12 Admin Key Rotation Without Two-Step

**Description**: Admin/authority changed in a single transaction. Typo in new address means permanent loss of control.

**What to look for**: `config.authority = new_authority` without pending/accept pattern.

**Secure pattern**: Two-step: `propose_new_authority` then `accept_authority` (new authority must sign the accept).

**Severity**: Medium | **Detection**: Requires reasoning

---

### 1.13 Duplicate Mutable Account Attacks

**Description**: Same account passed as two different parameters. Self-transfer, double-counting, or state corruption.

**What to look for**: Instructions with multiple accounts of the same type; missing `key != key` checks.

**Vulnerable**:
```rust
pub fn transfer(ctx: Context<Transfer>, amount: u64) -> Result<()> {
    ctx.accounts.source.balance -= amount;
    ctx.accounts.destination.balance += amount;
    // If source == destination: balance goes down then up, net 0
    // But if there's a fee: fee is charged but no actual transfer
}
```

**Secure**:
```rust
require!(
    ctx.accounts.source.key() != ctx.accounts.destination.key(),
    ErrorCode::DuplicateAccount
);
```

**Severity**: High | **Detection**: Partially script-detectable

---

## Domain 2: CPI and Token Handling

### 2.1 Unverified CPI Program ID

**Description**: `invoke`/`invoke_signed` called with a program account from user input without verifying it matches the expected program.

**Vulnerable**:
```rust
// program_account comes from transaction - could be anything
invoke(
    &instruction,
    &[source.clone(), dest.clone(), program_account.clone()],
)?;
```

**Secure**:
```rust
if program_account.key != &spl_token::id() {
    return Err(ProgramError::IncorrectProgramId);
}
invoke(&instruction, &[...])?;

// Anchor: Program<'info, Token> validates automatically
```

**Severity**: Critical | **Detection**: Script-detectable (find invoke with non-constant program ID)

---

### 2.2 Stale Data After CPI (Missing Reload)

**Description**: After a CPI mutates an account, the calling program continues using cached/stale in-memory data.

**Vulnerable**:
```rust
let balance_before = ctx.accounts.vault.amount; // Read
token::transfer(ctx.accounts.transfer_ctx(), amount)?; // CPI modifies vault
let balance_after = ctx.accounts.vault.amount; // STALE! Still shows old value
```

**Secure**:
```rust
token::transfer(ctx.accounts.transfer_ctx(), amount)?;
ctx.accounts.vault.reload()?; // Refresh from on-chain data
let balance_after = ctx.accounts.vault.amount; // Now correct
```

**Severity**: High | **Detection**: Script-detectable (CPI not followed by .reload())

---

### 2.3 Signer Privilege Escalation via invoke_signed

**Description**: `invoke_signed` elevates a PDA to signer status for a CPI. If the callee can mutate accounts beyond what was intended, excessive privilege is granted.

**What to look for**: `invoke_signed` passing accounts that shouldn't be mutable to the callee; PDA signing for untrusted programs.

**Severity**: Critical | **Detection**: Requires reasoning

---

### 2.4 SOL Drain Through CPI

**Description**: CPI callee can debit SOL from signer accounts. If a PDA with SOL balance is a signer in the CPI, the callee can drain it.

**Secure pattern**: Record lamport balances before CPI, verify after.
```rust
let balance_before = vault_pda.lamports();
invoke_signed(&ix, &accounts, &signer_seeds)?;
let balance_after = vault_pda.lamports();
require!(balance_after >= balance_before, ErrorCode::UnexpectedSolDrain);
```

**Severity**: Critical | **Detection**: Partially script-detectable

---

### 2.5 CPI Depth Limit Violations

**Description**: Solana limits CPI depth to 4. Programs calling programs calling programs can hit this limit, causing transaction failure.

**Severity**: Medium | **Detection**: Requires reasoning (analyze call graph from extract-cpis.py)

---

### 2.6 Return Data Spoofing

**Description**: Reading CPI return data without verifying which program set it. A malicious program in the call chain could set spoofed return data.

**Severity**: Medium | **Detection**: Requires reasoning

---

### 2.7 SPL Token Mint/Authority Mismatch

**Description**: Token operations use wrong mint or authority. Token account's mint doesn't match the expected mint for the pool/vault.

**Vulnerable**:
```rust
// No verification that token_account.mint matches expected mint
token::transfer(
    CpiContext::new(token_program, Transfer {
        from: user_token_account,
        to: vault_token_account, // Could have wrong mint
        authority: user,
    }),
    amount,
)?;
```

**Secure**:
```rust
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        constraint = user_token.mint == pool.token_mint,
    )]
    pub user_token: Account<'info, TokenAccount>,
}
```

**Severity**: High | **Detection**: Partially script-detectable

---

### 2.8 Token-2022 Extension Handling

**Description**: Token-2022 mints can have extensions that change behavior:
- **PermanentDelegate**: delegate can transfer anyone's tokens
- **TransferHook**: custom logic on every transfer
- **FreezeAuthority**: can freeze accounts
- **ConfidentialTransfer**: hidden amounts break accounting

**What to look for**: Programs accepting any mint without validating extensions at initialization.

**Secure pattern**: Validate extensions at initialization, reject dangerous ones:
```rust
let mint_data = mint_account.data.borrow();
let mint = StateWithExtensions::<Mint>::unpack(&mint_data)?;
if mint.get_extension::<PermanentDelegate>().is_ok() {
    return Err(ErrorCode::UnsupportedMintExtension.into());
}
```

**Severity**: High | **Detection**: Requires reasoning

---

### 2.9 Fee-on-Transfer Accounting Errors

**Description**: Token-2022 mints with transfer fees mean the received amount differs from the sent amount. Programs assuming equality break.

**Secure pattern**: Balance-delta accounting:
```rust
let balance_before = vault_token.amount;
token_2022::transfer_checked(ctx, amount, decimals)?;
vault_token.reload()?;
let actually_received = vault_token.amount - balance_before;
// Use actually_received, not amount
```

**Severity**: High | **Detection**: Requires reasoning

---

### 2.10 Legacy token::transfer with Token-2022 Mints

**Description**: Using legacy `token::transfer` instead of `transfer_checked` with Token-2022 mints bypasses transfer hooks and fee mechanisms.

**Vulnerable**: `token::transfer(ctx, amount)?;`
**Secure**: `token_2022::transfer_checked(ctx, amount, decimals)?;`

**Severity**: High | **Detection**: Script-detectable (flag token::transfer usage)

---

### 2.11 Missing transfer_checked Usage

**Description**: `transfer` doesn't verify decimals; `transfer_checked` does. Using unchecked transfer risks sending wrong decimal amounts.

**Severity**: Medium | **Detection**: Script-detectable

---

### 2.12 ATA Derivation Errors

**Description**: Incorrect Associated Token Account derivation using wrong seeds or program ID.

**Severity**: Medium | **Detection**: Script-detectable

---

## Domain 3: Arithmetic and Economic Security

### 3.1 Unchecked Arithmetic (Overflow/Underflow)

**Description**: Rust release builds wrap on overflow instead of panicking. Standard `+`, `-`, `*` silently produce wrong results.

**Vulnerable**:
```rust
let total = price * amount; // Can overflow u64 silently in release
let remaining = supply - burned; // Can underflow to u64::MAX
```

**Secure**:
```rust
let total = price.checked_mul(amount).ok_or(ErrorCode::Overflow)?;
let remaining = supply.checked_sub(burned).ok_or(ErrorCode::Underflow)?;
```

**Severity**: High-Critical | **Detection**: Script-detectable (find raw +, -, * on numeric types)

---

### 3.2 Division Before Multiplication (Precision Loss)

**Description**: Integer division truncates. `(a / b) * c` loses precision; `(a * c) / b` preserves it.

**Vulnerable**:
```rust
let fee = amount / FEE_DENOMINATOR * fee_rate; // Truncation before multiply
// amount=15000, denom=10000, rate=300 -> 1*300=300 (should be 450)
```

**Secure**:
```rust
let fee = amount.checked_mul(fee_rate)?.checked_div(FEE_DENOMINATOR)?;
```

**Severity**: Medium-High | **Detection**: Requires reasoning (must understand operation order)

---

### 3.3 Wrong Rounding Direction

**Description**: Rounding should favor the protocol. Deposits round shares down, withdrawals round tokens down, fees round up, debt rounds up.

**Vulnerable**:
```rust
// Fee rounds DOWN - user pays less fee than intended
let fee = amount * fee_bps / 10000;
```

**Secure**:
```rust
// Fee rounds UP
let fee = amount.checked_mul(fee_bps)?.checked_add(9999)?.checked_div(10000)?;
```

**Severity**: High | **Detection**: Requires reasoning

---

### 3.4 Zero-Amount Edge Cases

**Description**: Zero deposits, dust amounts truncating to zero shares, division by zero when pool is empty.

**Vulnerable**:
```rust
let shares = amount * total_shares / total_assets; // amount=1 -> shares=0
// User deposits tokens but gets 0 shares (funds lost)
```

**Secure**:
```rust
require!(amount > 0, ErrorCode::ZeroAmount);
let shares = amount.checked_mul(total_shares)?.checked_div(total_assets)?;
require!(shares > 0, ErrorCode::DepositTooSmall);
```

**Severity**: Medium-High | **Detection**: Partially script-detectable

---

### 3.5 Type Narrowing Without Bounds Check

**Description**: `as u64` silently truncates u128 values. `as` keyword never errors.

**Vulnerable**: `let val = big_u128 as u64;`
**Secure**: `let val = u64::try_from(big_u128).map_err(|_| ErrorCode::Overflow)?;`

**Severity**: High | **Detection**: Script-detectable (find `as u64`, `as u32` patterns)

---

### 3.6 Slippage Protection Bypass

**Description**: Missing min_output check, or check applied to gross amount before fees.

**Vulnerable**:
```rust
let gross_out = calculate_swap(amount_in)?;
require!(gross_out >= min_out, ErrorCode::Slippage); // Check on GROSS
let fee = gross_out * fee_bps / 10000;
let net_out = gross_out - fee; // User gets less than min_out!
```

**Secure**:
```rust
let net_out = gross_out - fee;
require!(net_out >= min_out, ErrorCode::Slippage); // Check on NET
```

**Severity**: High | **Detection**: Requires reasoning

---

### 3.7 Oracle Staleness / Confidence Interval

**Description**: Using oracle price without checking freshness or confidence interval. Stale prices enable arbitrage.

**Secure**:
```rust
let price = pyth_account.get_price_no_older_than(&clock, MAX_AGE_SECONDS)?;
let conf_pct = price.conf * 100 / price.price.unsigned_abs();
require!(conf_pct <= MAX_CONFIDENCE_PCT, ErrorCode::OracleUncertain);
```

**Severity**: High | **Detection**: Partially script-detectable

---

### 3.8 Reward Accounting Errors

**Description**: Three common patterns: (1) Settle before shrink: must distribute pending rewards before reducing total staked. (2) Retroactive rates: changing reward rate applies retroactively. (3) Dead share price: yield doesn't increment the numerator.

**Severity**: Critical | **Detection**: Requires reasoning

---

### 3.9 Vault Share Inflation Attack (First Depositor)

**Description**: First depositor deposits 1 token (1 share), then donates tokens directly to the vault. Next depositor's shares truncate to 0, losing their deposit.

**Secure patterns**: Virtual offset, minimum initial deposit, or dead shares (burn minimum on first deposit).

**Severity**: Critical | **Detection**: Requires reasoning

---

### 3.10 Bonding Curve Discontinuities

**Description**: Price jumps at curve segment boundaries. Reserve accounting errors at transition points.

**Severity**: High | **Detection**: Requires reasoning

---

### 3.11 Fee Ordering Errors (Net vs Gross Slippage)

**Description**: Slippage checked on gross before fees, but user receives net after fees.

**Severity**: High | **Detection**: Requires reasoning

---

### 3.12 Dead Share Price

**Description**: Share price reaches zero and cannot recover. When total_assets drops to 0 while shares exist, no new deposits can mint shares.

**Severity**: High | **Detection**: Requires reasoning

---

## Domain 4: State Machine and Account Lifecycle

### 4.1 Invalid State Transitions (Denylist vs Allowlist)

**Description**: `status != Closed` misses new states added later. Use allowlist: `status == Active || status == Pending`.

**Vulnerable**:
```rust
require!(pool.status != PoolStatus::Closed, ErrorCode::Closed);
// If PoolStatus::Frozen is added later, this check allows it
```

**Secure**:
```rust
require!(
    pool.status == PoolStatus::Active || pool.status == PoolStatus::Pending,
    ErrorCode::InvalidStatus
);
```

**Severity**: Medium-High | **Detection**: Requires reasoning

---

### 4.2 Terminal State Not Absorbing

**Description**: Terminal states (Closed, Finalized) can transition back to active states.

**Secure**: Terminal state check at the start of every state-changing instruction.

**Severity**: High | **Detection**: Requires reasoning

---

### 4.3 Account Revival After Close

**Description**: Closed account revived because it wasn't reassigned to system program and data wasn't zeroed.

**Vulnerable**:
```rust
// Only transfer lamports, don't zero data or reassign owner
**dest.lamports.borrow_mut() += source.lamports();
**source.lamports.borrow_mut() = 0;
// Account still owned by program, data still readable
```

**Secure**:
```rust
// 1. Zero data
let mut data = source.data.borrow_mut();
data.fill(0);
// 2. Transfer lamports
**dest.lamports.borrow_mut() += source.lamports();
**source.lamports.borrow_mut() = 0;
// 3. Assign to system program
source.assign(&system_program::id());

// Anchor: close = recipient handles all three
```

**Severity**: Critical | **Detection**: Partially script-detectable

---

### 4.4 Missing Data Zeroing on Close

**Description**: Account closed but data not zeroed. Data can be read or misinterpreted in the same transaction.

**Severity**: Medium | **Detection**: Script-detectable

---

### 4.5 Rent Exemption Violations

**Description**: Non-rent-exempt accounts can be garbage collected by the runtime. Attacker can trigger collection by reducing balance below threshold.

**Severity**: Medium | **Detection**: Script-detectable

---

### 4.6 Timestamp / Clock Safety

**Description**: Using `Clock::slot` for time-based logic. Slots are not constant time (slot duration varies). Use `unix_timestamp` for time, `slot` for ordering.

**Severity**: Medium | **Detection**: Partially script-detectable

---

### 4.7 Paired Time Gate Errors

**Description**: Complementary time checks that leave gaps. `can_deposit = now < deadline` and `can_withdraw = now > deadline + buffer` leaves a window where neither is possible.

**Severity**: Medium | **Detection**: Requires reasoning

---

### 4.8 Compute Budget DoS (Unbounded Loops)

**Description**: Loops over user-controlled data without bounds can exhaust the compute budget.

**Vulnerable**:
```rust
for item in ctx.accounts.list.items.iter() { // items could be huge
    process_item(item)?;
}
```

**Secure**:
```rust
let max_items = std::cmp::min(list.items.len(), MAX_ITEMS_PER_TX);
for item in list.items[..max_items].iter() {
    process_item(item)?;
}
```

**Severity**: Medium-High | **Detection**: Partially script-detectable

---

### 4.9 Storage Rent Attacks

**Description**: Attacker sends dust SOL to prevent account closure, or creates many accounts to waste protocol's rent.

**Severity**: Medium | **Detection**: Requires reasoning

---

### 4.10 BPF Stack Frame Overflow

**Description**: Solana BPF stack limit is 4096 bytes. Large structs on stack cause overflow.

**Secure**: Use `Box::new()` for large structs to allocate on heap.

**Severity**: Medium | **Detection**: Partially script-detectable

---

### 4.11 Unclosed Accounts (Rent Leakage)

**Description**: Program creates accounts but never provides a close mechanism. SOL locked in rent-exempt accounts permanently.

**Severity**: Low-Medium | **Detection**: Requires reasoning

---

### 4.12 init_if_needed Without Reinit Guard

**Description**: Anchor's `init_if_needed` creates OR uses existing. Attacker pre-creates account with malicious data (e.g., wrong authority).

**Severity**: High | **Detection**: Script-detectable (flag init_if_needed usage)

---

## Domain 5: Invariant and Business Logic

### 5.1 Conservation Law Violations

**Description**: Sum of parts doesn't equal total. After fee split: `fees + user_amount != original_amount`. Token balances don't sum to vault balance.

**What to look for**: Fee calculations where remainders are lost; value flows without conservation checks.

**Severity**: High | **Detection**: Requires reasoning

---

### 5.2 State Coupling Drift

**Description**: Related state variables updated independently. `total_staked` changes but `reward_per_token` doesn't update first.

**Vulnerable**:
```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    pool.total_staked += amount; // Changed total without settling rewards
    user.staked += amount;
    Ok(())
}
```

**Secure**:
```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    settle_rewards(&mut pool)?; // Update reward_per_token first
    pool.total_staked += amount;
    user.staked += amount;
    Ok(())
}
```

**Severity**: High | **Detection**: Requires reasoning

---

### 5.3 Round-Trip Asymmetry

**Description**: Deposit then withdraw returns different amount (beyond explicit fees). Value leaks on each cycle.

**What to check**: For every deposit/withdraw, stake/unstake, buy/sell pair, trace the math with specific amounts.

**Severity**: High | **Detection**: Requires reasoning

---

### 5.4 Path Divergence

**Description**: Multiple code paths for the same operation produce different outcomes. Two withdrawal methods with different fee calculations.

**Severity**: Medium-High | **Detection**: Requires reasoning

---

### 5.5 Commutativity Violations

**Description**: Order of operations matters when it shouldn't. Processing user A then B gives different results than B then A.

**Severity**: Medium | **Detection**: Requires reasoning

---

### 5.6 Cross-Instruction Reasoning Gaps

**Description**: Instructions called in unexpected order with unexpected intermediate state. State left "in between" by one instruction exploited by another.

**Severity**: High | **Detection**: Requires reasoning

---

### 5.7 Boundary Condition Abuse

**Description**: Extreme values break invariants: same account as two parameters, zero amounts, u64::MAX, empty pools, single-user withdrawal of all liquidity.

**Severity**: Medium-High | **Detection**: Partially script-detectable

---

## Detection Strategy Summary

| Strategy | Bug Classes |
|----------|------------|
| **Script-detectable** | 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 2.1, 2.2, 2.10, 2.11, 2.12, 3.1, 3.5, 4.4, 4.5, 4.12 |
| **Partially script-detectable** | 1.10, 1.13, 2.4, 2.7, 3.4, 3.7, 4.3, 4.6, 4.8, 4.10, 5.7 |
| **Requires reasoning** | 1.5, 1.8, 1.9, 1.11, 1.12, 2.3, 2.5, 2.6, 2.8, 2.9, 3.2, 3.3, 3.6, 3.8, 3.9, 3.10, 3.11, 3.12, 4.1, 4.2, 4.7, 4.9, 4.11, 5.1-5.6 |
