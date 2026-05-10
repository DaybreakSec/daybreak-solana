# Solana DeFi Audit Report Analysis

Cross-protocol analysis of 252 findings from 25 audit reports across Kamino Finance, Jupiter, and Meteora.
Auditors represented: OtterSec, Sec3, Offside Labs, Oak Security, Quantstamp, Sherlock, Certora, MixBytes, RonnyX.

---

## Bug Class Taxonomy (by frequency and severity)

### 1. Arithmetic & Rounding (48 findings, 6 critical/high)

**Share Inflation / First-Depositor Attack**: 7 findings across all 3 protocols
- Kamino Vault: incorrect shares denominator (invested vs total)
- Meteora DLMM: Q64x64 truncation enables 22-billion-x inflation in ~40 iterations
- Meteora Dynamic Vault: deposit 1 token, donate large amount, subsequent depositors get 0 shares
- Pattern: division-before-multiplication in share minting; fixed-point to integer truncation

**Incorrect Fee Formulas**: 12 findings
- Jupiter Swap v6: piecewise positive-slippage fee is non-monotonic (fee *decreases* past threshold)
- Jupiter Swap v6: fee can exceed positive slippage, user receives less than quoted
- Meteora DLMM: composition fee calculated before share minting, diluted by new shares
- Jupiter Perps: exit fee doesn't account for unrealized PnL
- Pattern: fee functions that aren't tested across full input range; fees computed on wrong basis amount

**Unchecked / Overflow Arithmetic**: 15 findings
- `as u64` truncation from u128 without overflow check
- `pow()` instead of `checked_pow()` in curve math
- Division by zero in utility functions (using `/` instead of `checked_div`)
- Accumulator overflow in loop summations

**Rounding Direction**: 8 findings
- Withdrawals round in user's favor (should round down for user, up for protocol)
- `_ceil` functions that don't actually ceil
- Presale deposit suggestions round down, preventing completion

**Off-by-One**: 6 findings
- Elevation group 0-based vs 1-based indexing
- Slippage check using `>` instead of `>=`
- Power function boundary using `>` instead of `>=` at MAX_EXPONENTIAL

### 2. Oracle Vulnerabilities (14 findings, 3 critical/high)

**Disabled/Null Oracle Bypass**: 1 critical
- Kamino Lend: null_key oracle skips price validation entirely, accepts arbitrary price

**Missing Staleness Checks**: 5 findings
- Jupiter Perps: oracle price consumed without timestamp check
- Kamino Lend: TWAP expiry never checked (only spot price staleness)
- Jupiter Lend: Switchboard feeds lack staleness check while Pyth has one
- Pattern: staleness checked for one oracle type but not another

**Flash-Loan Price Manipulation**: 2 findings
- Kamino Liquidity: spot AMM prices used instead of TWAPs
- Pattern: on-chain pool prices are manipulable within a single transaction

**Zero/Invalid Price Acceptance**: 2 findings
- Jupiter Lend: oracle returning zero price not rejected
- Wide confidence intervals accepted (2% threshold too lenient)

**Deprecated Oracle SDKs**: 2 findings
- Using `pyth_sdk_solana` instead of `pyth_solana_receiver_sdk` (pull-based model)

**TWAP Update Ordering**: 2 findings
- Oracle sample updated after swap instead of before, capturing wrong state

### 3. Access Control & Account Validation (38 findings, 10 critical/high)

**Missing Signer Checks**: 3 findings (1 critical)
- Jupiter Swap v3: `swap_authority` not validated as signer, so anyone can drain token accounts
- Pattern: authority accounts without `Signer` type or `is_signer` constraint

**Missing Cross-Account Ownership Validation**: 12 findings
- Kamino Lend: obligation_farm not verified to belong to the obligation
- Kamino Lend: reserve not verified to belong to the lending_market on farm init
- Kamino Liquidity: reward vault overwrite, no authority check on UpdateRewardMapping
- Dynamic Vault: fake obligation accounts accepted in withdraw_directly_from_strategy
- Pattern: derived/associated accounts loaded without verifying parent relationship

**Missing Token Account Owner Checks**: 4 findings
- Jupiter Swap v3: token accounts not validated to belong to swap authority
- Pattern: `token_account.owner == expected_authority` not checked

**Missing CPI Target Validation**: 3 findings
- Kamino Liquidity: CPI target program ID not verified
- Dynamic Vault: counterfeit strategy_program accepted
- Pattern: CPI calls to user-supplied program accounts without ID check

**Admin Transfer Without Acceptance**: 4 findings
- Single-step admin transfer risks permanent lockout
- Kamino Lend: farm admin not updated when lending market ownership transfers
- Pattern: admin identity cached in downstream programs not updated on transfer

**Inconsistent Enabled/Disabled Checks**: 3 findings
- Meteora DAMM v1: remove_balance_liquidity callable while pool disabled
- Pattern: some functions check pool.enabled, others don't

**Unbounded Admin Parameters**: 5 findings
- Pool fees settable to 100% (no upper bound)
- Amplification factor changeable without timelock
- Fee authority can set arbitrarily high fees

### 4. State Lifecycle & Staleness (22 findings, 5 critical/high)

**Stale Accumulator / Missing Refresh**: 8 findings
- Kamino Lend: config update changes rate without first accruing at old rate
- Kamino Lend: obligation not refreshed before reading borrowed_amount_wads
- Jupiter Perps: cumulative_interest_snapshot not updated on position modify
- Kamino Farms: reward parameters changed without settling accrued rewards
- Pattern: any operation that changes rate/fee params must first settle pending amounts at old params

**Orphaned References**: 4 findings
- Kamino Lend: removing elevation_group from config orphans obligations referencing it
- Obligations fail to refresh → liquidation blocked → bad debt
- Pattern: admin-mutable IDs stored as references in user accounts

**Missing Staleness Marking**: 3 findings
- Kamino Lend: request_elevation_group doesn't mark obligation stale
- Attacker gets elevated LTV, switches back, borrows at elevated rate against non-eligible collateral
- Pattern: state changes that affect risk parameters without invalidating cached health checks

**State Overwrite Without Settlement**: 4 findings
- Kamino Liquidity: open_liquidity_position overwrites without harvesting rewards
- Kamino Farms: staking additional tokens double-counts pending stake
- Pattern: "open"/"reset" instructions that overwrite user state without settling pending balances

**Profit Unlock Timer Reset**: 3 findings
- Meteora Dynamic Vault: any update resets unlock timer, delaying profit distribution indefinitely
- Pattern: drip/unlock mechanisms that reset on any state update instead of only on new profit

### 5. Token-2022 Compatibility (9 findings, 2 high)

**Transfer Fee Not Accounted**: 5 findings
- Kamino Limo: records `input_amount` but vault receives less due to transfer fee
- Meteora DAMM v2: uses raw `amount_in` instead of post-fee amount for swap
- Pattern: any Token-2022 token flow that records the instruction amount rather than the actual received amount

**ATA Derivation with Wrong Program ID**: 2 findings
- Using `get_associated_token_address` (hardcodes SPL Token) instead of `get_associated_token_address_with_program_id`

**Transfer Hook Bypasses Whitelist**: 1 finding
- Token-2022 transfer hooks invoke arbitrary programs, bypassing instruction-level program whitelists

**Missing Extension Handling**: 1 finding
- MemoTransfer extension not handled; transfers fail if destination requires memo

### 6. Economic / MEV Attacks (18 findings, 5 critical/high)

**Sandwich Attacks on Admin Operations**: 4 findings
- Amplification factor changes without timelock → sandwich
- Fee changes without bounds → sandwich
- Rebalance crank without slippage protection → sandwich
- Pattern: any value-affecting parameter change that takes effect immediately

**Volatility/Fee Manipulation**: 3 findings
- Meteora DLMM: small periodic swaps keep volatility accumulator at max, inflating fees
- Pattern: time-decay mechanisms that reset on any interaction can be permanently pegged to extremes

**Staleness-Gated Liquidation Exploit**: 1 high
- Kamino Lend: low-activity reserves hit staleness threshold → self-liquidation with flash loan
- Pattern: liquidation triggers based on time-since-last-update on low-volume markets

**Flash Loan Amplification**: 2 findings
- Deposit collateral → borrow → self-liquidate at discount, all with flash-loaned capital
- Flashloan repayment check doesn't include fee (free flashloan)

**Empty Bin/Pool Reward Theft**: 3 findings
- Add liquidity to empty active bin → capture accumulated rewards → remove in same tx
- Pattern: reward accumulators that don't advance during zero-liquidity periods

**Pool AUM Includes Wrong Components**: 3 findings
- AUM includes unredeemed protocol fees, pending rewards, or excludes open position PnL
- Pattern: TVL/AUM calculations must include exactly the right components

### 7. DoS / Griefing (10 findings, 3 high)

**PDA Pre-funding**: 2 findings
- Kamino Limo: `system_instruction::create_account` fails if PDA already has lamports
- Pattern: attacker sends lamports to PDA address before legitimate init, permanently blocking it

**Compute Unit Exhaustion**: 2 findings
- Meteora DLMM: dust deposits in many bins force swaps to traverse all, exceeding CU limit
- Jupiter Swap v3: unlimited swap hops consume excessive compute

**Keeper Poisoning**: 3 findings
- Jupiter Perps: user creates request then deletes ATA → request permanently unprocessable
- Keeper polls every 600ms, processing ghost requests indefinitely
- Pattern: off-chain keeper loops that can't skip/quarantine bad requests

**Farm Init PDA Collision**: 1 finding
- Kamino Lend: init farms with wrong lending_market → PDA collision blocks legitimate init forever

**Merkle Root Versioning**: 1 finding
- Meteora Presale: old Merkle roots remain valid after update; removed users can still participate

### 8. Cross-Protocol / CPI Issues (8 findings)

**Unvalidated CPI Accounts**: 4 findings
- Dynamic Vault Solend integration lacks account validation
- Strategy withdrawal accepts fake obligation accounts

**Cross-Vault Confusion**: 2 findings
- Vaults can claim strategies belonging to other vaults
- Reward collateral_id not bounds-checked

**Instruction Introspection Bypass**: 2 findings
- Kamino Lend: flash-loan instruction sequence check doesn't distinguish before/after
- Meteora DAMM v2: swap restriction checks `swap` discriminator but not `swap2`

### 9. Reward Distribution Fairness (8 findings)

**Multi-Bin/Multi-Reserve Reward Skipping**: 3 findings (found independently by 3 different auditors)
- During multi-bin swaps, only starting bin gets reward update; intermediate bins skipped
- Pattern: iterate reward updates over ALL bins/reserves touched, not just active one

**Zero-Liquidity Period Handling**: 3 findings
- Rewards accumulate during zero-liquidity periods; first depositor captures all
- `last_update_time` not advanced during empty periods

**Composition Fee Into Shares**: 2 findings
- Fees added directly to liquidity shares inflates share-to-asset ratio
- Should track fees separately from LP shares

### 10. Missing Functionality / Locked Funds (6 findings)

**No Fee Withdrawal Mechanism**: 2 findings (found by both RonnyX and OtterSec on Kamino Lend)
- fee_vault accumulates protocol fees with no admin withdrawal instruction

**No Circuit Breaker**: 2 findings
- No emergency pause for black swan events in underlying lending protocols

**Dust/Remainder Lockup**: 2 findings
- Small amounts become permanently locked due to rounding or minimum balance requirements

---

## Detection Heuristics

### H1: Share/Exchange Rate Manipulation
```
TRIGGER: Any vault/pool with deposit → shares minting
CHECK:
  1. What is the denominator in share calculation? Must include ALL assets (invested + idle + pending)
  2. Is there a minimum first deposit or virtual offset (dead shares)?
  3. Can an attacker donate tokens directly to inflate the exchange rate?
  4. Is division-before-multiplication used in share math?
  5. Does fixed-point → integer conversion truncate in a way that can be exploited iteratively?
```

### H2: Oracle Trust Boundaries
```
TRIGGER: Any oracle price consumption
CHECK:
  1. Staleness check on ALL oracle types (spot, TWAP, Pyth, Switchboard)
  2. Confidence interval validation
  3. Zero/negative price rejection
  4. Is price source a spot AMM pool price? (flash-loan manipulable)
  5. Is the oracle SDK current? (deprecated pyth_sdk_solana)
  6. What happens when oracle is disabled/null? Does it skip validation?
  7. TWAP update ordering: before or after state change?
```

### H3: Rate/Parameter Change Settlement
```
TRIGGER: Any admin function that modifies a rate, fee, or reward parameter
CHECK:
  1. Does it first accrue/settle pending amounts at the OLD rate?
  2. Does it invalidate/refresh dependent state (obligations, positions)?
  3. Is there a timelock or cooldown?
  4. Are there upper/lower bounds enforced?
  5. Can admin ownership transfer leave downstream programs with stale admin?
```

### H4: Token-2022 Compatibility
```
TRIGGER: Any token transfer or ATA derivation
CHECK:
  1. Is the recorded amount the instruction amount or the actual received amount?
  2. Is ATA derived with correct program ID (Token vs Token-2022)?
  3. Does the code handle TransferFee, MemoTransfer, TransferHook extensions?
  4. Can transfer hooks invoke arbitrary programs that bypass whitelists?
  5. Are multi-transfer splits calculating per-transfer fees correctly?
```

### H5: Instruction Sequence / Flash Loan Protection
```
TRIGGER: Any sysvar::instructions introspection or flash-loan pattern
CHECK:
  1. Does the check distinguish instruction index direction (before vs after)?
  2. Are ALL equivalent instruction variants checked (swap, swap2, swap_v2)?
  3. Does flashloan repayment check include principal + fee, not just balance restoration?
  4. Can instruction ordering be crafted to satisfy pre-checks with post-instructions?
```

### H6: Account Relationship Validation
```
TRIGGER: Any instruction that loads accounts with parent-child relationships
CHECK:
  1. obligation_farm.obligation == obligation.key()
  2. reserve.lending_market == lending_market.key()
  3. token_account.owner == expected_authority
  4. CPI target program matches expected program ID
  5. Anti-aliasing: are two account parameters validated to be different?
  6. For Token-2022: does ATA derivation use the correct token program?
```

### H7: Reward Distribution Fairness
```
TRIGGER: Any reward/fee distribution mechanism
CHECK:
  1. Multi-bin/multi-reserve: are ALL touched bins updated, not just the active one?
  2. Zero-liquidity periods: is last_update_time advanced even with no LPs?
  3. Can someone add+remove liquidity in same tx to capture accumulated rewards?
  4. Are composition fees tracked separately from LP shares?
  5. Does the reward cursor initialize to the current global value on user creation?
```

### H8: PDA and Account Init Safety
```
TRIGGER: Any instruction that creates accounts at PDA addresses
CHECK:
  1. Does it use system_instruction::create_account? (fails if pre-funded)
  2. Can an attacker pre-fund the PDA with lamports to permanently block init?
  3. Are PDA bump seeds validated during initialization?
  4. Can init be called with wrong parent accounts to cause PDA collision?
```

### H9: Keeper/Crank Robustness
```
TRIGGER: Any off-chain keeper or crank mechanism
CHECK:
  1. Can users create permanently unprocessable requests (e.g., delete ATA after request)?
  2. Does the keeper skip/quarantine failed requests after N retries?
  3. Is the crank permissionless? (allows MEV timing)
  4. Does the keeper check request.executed before processing?
  5. Are there compute budget limits for operations the keeper triggers?
```

### H10: State Lifecycle Consistency
```
TRIGGER: Any enabled/disabled flag, status enum, or lifecycle state
CHECK:
  1. Do ALL state-mutating functions check the enabled/disabled flag?
  2. Can admin functions execute while pool is disabled?
  3. Are update-single-field and update-entire-config paths equally validated?
  4. When a config entry is removed, are user references to it handled gracefully?
  5. Does "open"/"reset" settle pending balances before overwriting?
```

### H11: Economic Griefing Vectors
```
TRIGGER: Any time-decay or volatility mechanism
CHECK:
  1. Can frequent small interactions prevent decay (keep fees/volatility at max)?
  2. Can profit unlock timers be reset by any interaction?
  3. Are there minimum amounts to prevent dust griefing?
  4. Can fee parameters be sandwiched (instant effect without timelock)?
  5. For rebalance cranks: is there slippage protection?
```

---

## Highest-Value Reports (recommended samples)

### Tier 1: Keep as reference samples
These reports have the highest density of novel, well-documented findings:

1. **Kamino Lend - RonnyX** (`kamino_lend_rx.pdf`)
   - 12 findings (1C/3H/3M), exceptional root-cause depth
   - Covers oracle bypass, staleness-gated liquidation, elevation group abuse
   - Best example of a thorough lending protocol audit

2. **Meteora DLMM - Sec3** (`sec3-dlmm-audit-feb-2024.pdf`)
   - 19 findings covering bin-based AMM edge cases
   - Alpha access bypass, volatility manipulation, reward fairness
   - Strong reference for concentrated liquidity / DLMM audits

3. **Meteora DLMM - Offside Labs** (`offside-labs-dlmm-audit-jan-2024.pdf`)
   - 11 findings including critical share inflation attack
   - Excellent documentation of the Q64x64 truncation exploit chain
   - Good complement to Sec3 report (different perspective, same codebase)

4. **Jupiter Perpetual - Sec3** (`perpetual-sec3.pdf`)
   - 22 findings spanning smart contract + keeper
   - Best reference for perpetuals: average entry price, funding rate, liquidation
   - Includes keeper-layer findings (rare in audits)

5. **Meteora Dynamic Vault - Quantstamp** (`quantstamp-dynamic-vault-audit-jun-2022.pdf`)
   - 22 findings covering vault-strategy architecture
   - Admin fund theft via fake obligation, cross-vault confusion, donation attacks
   - Best reference for vault/strategy pattern audits

6. **Meteora DAMM v1 - Oak Security** (`oak-damm-v1-oct-2022-audit.pdf`)
   - 26 findings, very thorough AMM audit
   - Admin sandwich, stable swap curve overflow, disabled-state inconsistency
   - Good baseline for constant-product/stable-swap AMM audits

### Tier 2: Worth keeping for specific bug class coverage
7. **Kamino Limo - Sec3**: Token-2022 issues, PDA pre-funding DoS
8. **Jupiter Swap v6 - Offside Labs (Oct 2025)**: Non-monotonic fee curves
9. **Jupiter Lend - OtterSec**: Interest rate, borrow weight, utilization cap
10. **Meteora Dynamic Vault - Sherlock**: Share inflation, profit unlock griefing

---

## Protocol-Specific Attack Surface Map

### Lending Protocols (Kamino Lend, Jupiter Lend)
Priority bug classes: Oracle, Interest Accrual, Liquidation, Elevation Groups, Flash Loans
- Oracle disabled/stale → arbitrary price → drain protocol
- Rate parameter changes without accrual settlement
- Elevation group lifecycle → orphaned obligations → blocked liquidation
- Utilization rate uncapped → depositor bank run
- Borrow weight omission in health calculations

### Perpetual Exchanges (Jupiter Perps)
Priority bug classes: Price Source, PnL Calculation, Keeper, Funding Rate
- Liquidation using wrong price source (mark vs oracle)
- Average entry price miscalculation on partial close
- Cumulative interest snapshot not updated on modification
- Keeper poisoning via unprocessable requests
- AUM calculation including wrong components

### AMM / DLMM (Meteora DAMM, DLMM)
Priority bug classes: Share Inflation, Bin Manipulation, Fee Manipulation, Reward Fairness
- First-depositor inflation via donation or Q64x64 truncation
- Bin dust deposits → compute unit exhaustion on swaps
- Volatility accumulator kept at max via periodic small swaps
- Multi-bin reward skipping
- Composition fee dilution by share minting

### Vaults (Kamino Vault, Meteora Dynamic Vault)
Priority bug classes: Share Calculation, Strategy Validation, Rebalance MEV, Admin
- Share denominator using invested-only instead of total value
- Fake obligation/strategy accounts in CPI
- Permissionless crank → MEV extraction during rebalance
- No withdrawal fee → rapid in-out arbitrage
- Profit unlock timer griefing

### Limit Orders / Aggregators (Kamino Limo, Jupiter Swap, Jupiter Limit)
Priority bug classes: Token-2022, DoS, Slippage, Fee Curves
- PDA pre-funding blocks wSOL order execution permanently
- Transfer fee extension misaccounting
- Aggregate slippage check on final leg only (intermediate legs vulnerable)
- Non-monotonic piecewise fee functions
- Missing signer check on swap authority (critical)

---

## Cross-Protocol Statistics

| Bug Class | Kamino (70) | Jupiter (81) | Meteora (101) | Total | % of All |
|-----------|-------------|--------------|---------------|-------|----------|
| Arithmetic/Rounding | 12 | 20 | 16 | 48 | 19% |
| Access Control | 15 | 7 | 16 | 38 | 15% |
| State Lifecycle | 10 | 5 | 7 | 22 | 9% |
| Economic/MEV | 4 | 5 | 9 | 18 | 7% |
| Oracle | 5 | 7 | 2 | 14 | 6% |
| DoS/Griefing | 3 | 4 | 3 | 10 | 4% |
| Token-2022 | 2 | 1 | 6 | 9 | 4% |
| Reward Fairness | 3 | 0 | 5 | 8 | 3% |
| CPI/Cross-Protocol | 2 | 1 | 5 | 8 | 3% |
| Missing Functionality | 3 | 0 | 3 | 6 | 2% |
| Code Quality/Info | 11 | 31 | 30 | 72 | 29% |

**Critical+High findings by class:**
1. Access Control / Account Validation: 10
2. Arithmetic / Share Inflation: 6
3. Economic / MEV: 5
4. State Lifecycle / Staleness: 5
5. Oracle: 3
6. DoS: 3
7. Token-2022: 2
