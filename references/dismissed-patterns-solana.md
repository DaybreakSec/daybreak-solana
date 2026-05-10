# Dismissed Patterns: Solana / Anchor

Known false positive patterns. When a finding matches one of these patterns, it should be REFUTED unless the agent provides a specific explanation of why the standard defense is insufficient in this particular context.

---

## 1. Anchor Auto-Discriminator Check
**Pattern**: "Missing discriminator check on account deserialization"
**Why it's a false positive**: Anchor's `Account<'info, T>` type automatically checks the 8-byte discriminator prefix during deserialization. If the discriminator doesn't match, the instruction fails.
**When it IS a real finding**: When using `AccountInfo` or `UncheckedAccount` without manual discriminator verification. When using `try_from_slice` on raw data without a type tag check.

## 2. Anchor Owner Validation
**Pattern**: "Missing owner check on program-owned account"
**Why it's a false positive**: Anchor's `Account<'info, T>` automatically verifies `account.owner == program_id` during deserialization.
**When it IS a real finding**: When using raw `AccountInfo`, `UncheckedAccount`, or deserializing with `try_from_slice` without explicit `account.owner == program_id` checks.

## 3. Signer Type Enforcement
**Pattern**: "Missing signer check on authority account"
**Why it's a false positive**: Anchor's `Signer<'info>` type automatically enforces that the account is a transaction signer.
**When it IS a real finding**: When authority is accepted as `AccountInfo` without `is_signer` check, or when the signer check exists but the signed account is not validated against stored authority.

## 4. Program ID via Program<T>
**Pattern**: "CPI target program not validated"
**Why it's a false positive**: Anchor's `Program<'info, T>` type validates the program ID against the expected value.
**When it IS a real finding**: When program is passed as `AccountInfo` or `UncheckedAccount` without explicit `key == expected_program_id` check.

## 5. PDA Derivation via seeds+bump
**Pattern**: "PDA not verified / bump not canonical"
**Why it's a false positive**: Anchor's `seeds = [...], bump` constraint re-derives the PDA and verifies it matches the passed account. Using `bump = account.stored_bump` uses the stored canonical bump.
**When it IS a real finding**: When using `create_program_address` with user-supplied bump, or when seeds are constructed from user-controlled variable-length inputs without length prefixes.

## 6. has_one Constraint
**Pattern**: "Cross-account relationship not validated"
**Why it's a false positive**: Anchor's `has_one = field_name` checks that `account.field_name == other_account.key()`.
**When it IS a real finding**: When the relationship check is missing entirely, or when `has_one` checks the wrong field.

## 7. System Program Signer Requirement
**Pattern**: "SOL transfer from payer without signer check"
**Why it's a false positive**: The System Program's `transfer` instruction requires the source to be a signer. The runtime enforces this even without explicit program-level checks.
**When it IS a real finding**: When the program uses `invoke_signed` to transfer SOL from a PDA without proper authorization checks on who can trigger the transfer.

## 8. Transaction Atomicity
**Pattern**: "Partial state update if instruction fails mid-execution"
**Why it's a false positive**: Solana transactions are atomic; if an instruction returns an error, ALL state changes within that instruction are reverted.
**When it IS a real finding**: When the error is CAUGHT within the instruction (e.g., match on CPI result) and execution continues with inconsistent state.

## 9. Anchor close Constraint
**Pattern**: "Account data not zeroed on close / account revival possible"
**Why it's a false positive**: Anchor's `#[account(close = destination)]` zeroes the discriminator and data, transfers all lamports, and reassigns ownership to the System Program. Additionally, any attempt to re-use the account will fail the discriminator check.
**When it IS a real finding**: When manual close logic is used without zeroing data, or when `init_if_needed` could re-create the account at the same PDA address.

## 10. Rent Exemption Enforcement
**Pattern**: "Account may lose rent exemption"
**Why it's a false positive**: Since Solana removed non-rent-exempt accounts, all accounts must be rent-exempt at creation. The runtime enforces this.
**When it IS a real finding**: When `realloc` increases account size without adding lamports for the new rent-exempt minimum.

## 11. Token Account via Account<TokenAccount>
**Pattern**: "Token account mint not validated"
**Why it's a false positive**: When combined with `token::mint = expected_mint` or `constraint = token_account.mint == expected.key()`, the mint is validated.
**When it IS a real finding**: When `Account<'info, TokenAccount>` is used WITHOUT any constraint tying it to the expected mint.

## 12. init vs init_if_needed
**Pattern**: "Reinitialization possible"
**Why it's a false positive**: Anchor's `init` constraint will fail if the account already exists (has lamports). It cannot reinitialize.
**When it IS a real finding**: When `init_if_needed` is used AND the instruction handler unconditionally overwrites state fields without checking an `is_initialized` flag.

## 13. Box<Account> Boxing
**Pattern**: "Stack overflow due to large account struct"
**Why it's a false positive**: `Box<Account<'info, T>>` moves the deserialized account data to the heap, preventing stack overflow for large structs. This is the standard Anchor pattern for accounts > 4KB.
**When it IS a real finding**: When the boxed account is `UncheckedAccount` without downstream validation, or when boxing masks the real issue of an oversized instruction accounts struct.

## 14. remaining_accounts Iteration
**Pattern**: "Unchecked accounts in remaining_accounts"
**Why it's a false positive**: `remaining_accounts` is frequently used for variable-length lists (e.g., token accounts for batch operations). When the handler validates each account during iteration (checking owner, discriminator, or key against expected values), this is safe.
**When it IS a real finding**: When `remaining_accounts` entries are used without any validation, particularly when used as writable or as CPI targets.

## 15. zero_copy Deserialization
**Pattern**: "Account data not validated / unsafe deserialization"
**Why it's a false positive**: Anchor's `AccountLoader<'info, T>` with `#[account(zero_copy)]` still validates the discriminator and owner. The `zero_copy` attribute only changes the deserialization strategy (mmap vs copy).
**When it IS a real finding**: When `zero_copy` is combined with `UncheckedAccount` or when the struct layout has alignment issues that could cause field misreads.

## 16. realloc Constraint
**Pattern**: "Account size increased without rent check"
**Why it's a false positive**: Anchor's `#[account(realloc = new_size, realloc::payer = payer, realloc::zero = false)]` constraint handles rent-exemption lamport transfers automatically.
**When it IS a real finding**: When `realloc` is done manually via `AccountInfo::realloc()` without adjusting lamports for the new rent-exempt minimum.

## 17. constraint = vs handler require!
**Pattern**: "Validation only in constraint, not in handler" or vice versa
**Why it's a false positive**: Anchor `constraint = expr` checks run before the handler body. Using either location is valid; the constraint approach is preferred as it fails early with clear errors.
**When it IS a real finding**: When the constraint references stale data (e.g., checks a field that gets modified by a CPI before the handler uses it), or when the constraint is bypassable through account ordering.

## 18. Pyth get_price_no_older_than Combined Check
**Pattern**: "Oracle price staleness not checked"
**Why it's a false positive**: `get_price_no_older_than(clock, max_age)` combines both the staleness check and price retrieval in one call, atomically validating the price age.
**When it IS a real finding**: When the `max_age` parameter is excessively large (e.g., > 60 seconds for DeFi), or when the confidence interval (`price.conf`) is not checked against the price magnitude.
