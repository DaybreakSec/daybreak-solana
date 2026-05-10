#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'server', 'state');
const args = process.argv.slice(2);
const scanning = args.includes('--scanning');
const clean = args.includes('--clean');

// ── Helpers ─────────────────────────────────────────────────────────────────

function write(filename, data) {
  fs.writeFileSync(path.join(STATE_DIR, filename), JSON.stringify(data, null, 2));
  console.log(`  wrote state/${filename}`);
}

// ── Clean ───────────────────────────────────────────────────────────────────

if (clean && fs.existsSync(STATE_DIR)) {
  const files = fs.readdirSync(STATE_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) fs.unlinkSync(path.join(STATE_DIR, f));
  console.log(`  cleaned ${files.length} file(s) from state/`);
}

if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

// ── audit.json ──────────────────────────────────────────────────────────────

write('audit.json', {
  phase: 'done',
  mode: 'git',
  repoUrl: 'https://github.com/example-dao/vault-program',
  scopeNotes:
    'Focus on deposit/withdraw flows and admin privilege escalation. ' +
    'The vault uses a PDA-based authority pattern.',
  startedAt: '2026-05-07T09:12:00.000Z',
  maxTokenBudget: 1000000,
});

// ── scope.json ──────────────────────────────────────────────────────────────

write('scope.json', {
  framework: 'anchor',
  loc: 2847,
  files: [
    { path: 'programs/vault/src/lib.rs',                     loc: 156 },
    { path: 'programs/vault/src/state/vault.rs',             loc: 189 },
    { path: 'programs/vault/src/state/config.rs',            loc: 124 },
    { path: 'programs/vault/src/instructions/initialize.rs', loc: 345 },
    { path: 'programs/vault/src/instructions/deposit.rs',    loc: 512 },
    { path: 'programs/vault/src/instructions/withdraw.rs',   loc: 687 },
    { path: 'programs/vault/src/instructions/admin.rs',      loc: 398 },
    { path: 'programs/vault/src/errors.rs',                  loc: 436 },
  ],
  excludedFiles: [],
  accepted: true,
  acceptedAt: '2026-05-07T09:14:22.000Z',
});

// ── progress.json ───────────────────────────────────────────────────────────

const progressDone = {
  phase: 'done',
  scope: { framework: 'anchor', loc: 2847 },
  agents: {
    'accounts-access':      { status: 'complete', duration: '14.2s', findings: 3, tokensUsed: 142800 },
    'cpi-token':            { status: 'complete', duration: '11.8s', findings: 2, tokensUsed: 118400 },
    'arithmetic-economic':  { status: 'complete', duration: '18.6s', findings: 3, tokensUsed: 186200 },
    'state-lifecycle':      { status: 'complete', duration: '9.4s',  findings: 2, tokensUsed: 94600 },
    'invariant-logic':      { status: 'complete', duration: '12.1s', findings: 2, tokensUsed: 106000 },
  },
};

const progressScanning = {
  phase: 'agents',
  scope: { framework: 'anchor', loc: 2847 },
  agents: {
    'accounts-access':      { status: 'complete', duration: '14.2s', findings: 3, tokensUsed: 142800 },
    'cpi-token':            { status: 'complete', duration: '11.8s', findings: 2, tokensUsed: 118400 },
    'arithmetic-economic':  { status: 'scanning', currentFile: 'instructions/withdraw.rs', findings: 1, tokensUsed: 86200 },
    'state-lifecycle':      { status: 'queued', findings: 0, tokensUsed: 0 },
    'invariant-logic':      { status: 'complete', duration: '12.1s', findings: 2, tokensUsed: 106000 },
  },
};

write('progress.json', scanning ? progressScanning : progressDone);

// ── sanitize.json ───────────────────────────────────────────────────────────

write('sanitize.json', {
  risk_level: 'medium',
  warnings: [
    {
      file: 'programs/vault/src/instructions/deposit.rs',
      line: 87,
      pattern: 'ignore previous instructions',
      category: 'prompt_injection_ignore_previous',
    },
    {
      file: 'programs/vault/src/state/config.rs',
      line: 23,
      pattern: 'you are now a helpful assistant',
      category: 'prompt_injection_role_override',
    },
  ],
});

// ── findings.json ───────────────────────────────────────────────────────────
//
// 12 findings: 2 crit, 3 high, 3 med, 2 low, 2 info
// Kanban: 7 pending, 2 valid, 3 dismissed
// All 5 agents represented; realistic Solana bug classes
// Raw Rust code, CodeBlock tokenizes client-side

const findings = [
  // ═══ CRITICAL ═════════════════════════════════════════════════════════════

  {
    id: 'f-001',
    agent: 'accounts-access',
    severity: 'critical',
    title: 'Missing signer check on withdraw authority',
    description:
      'The `withdraw` instruction does not verify that `authority` is a signer. ' +
      'An attacker can pass any account as the authority and drain the vault. ' +
      'The `has_one` constraint checks ownership but the `Signer` type constraint is absent.',
    file: 'programs/vault/src/instructions/withdraw.rs',
    line: 42,
    bugClass: 'missing-signer-check',
    status: 'pending',
    proof: `#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = authority)]
    pub vault: Account<'info, Vault>,
    // BUG: should be Signer<'info>
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
}`,
    highlightLines: [46, 47],
    recommendation:
      'Change the `authority` field type from `AccountInfo` to `Signer` ' +
      'to enforce that the authority must sign the transaction.',
    dedupKey: 'vault|withdraw|missing-signer-check',
  },

  {
    id: 'f-002',
    agent: 'cpi-token',
    severity: 'critical',
    title: 'Unchecked token mint in deposit instruction',
    description:
      'The `deposit` instruction accepts any SPL token mint without validating ' +
      'it matches the vault\'s expected mint. An attacker could deposit worthless ' +
      'tokens while the accounting logic credits them as the legitimate asset.',
    file: 'programs/vault/src/instructions/deposit.rs',
    line: 31,
    bugClass: 'token-mint-mismatch',
    status: 'pending',
    proof: `#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    // BUG: no constraint validating mint == vault.mint
    pub user_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}`,
    highlightLines: [36, 37, 38],
    recommendation:
      'Add a `constraint = mint.key() == vault.mint` attribute to the `mint` account, ' +
      'or add a `has_one = mint` constraint to the vault account.',
    dedupKey: 'vault|deposit|token-mint-mismatch',
  },

  // ═══ HIGH ═════════════════════════════════════════════════════════════════

  {
    id: 'f-003',
    agent: 'arithmetic-economic',
    severity: 'high',
    title: 'Integer overflow in reward calculation',
    description:
      'The reward calculation multiplies `deposit_amount` by `reward_rate` without ' +
      'checked arithmetic. For large deposits near `u64::MAX`, this overflows silently ' +
      'and wraps to a small value, causing drastically fewer rewards than expected.',
    file: 'programs/vault/src/instructions/withdraw.rs',
    line: 128,
    bugClass: 'arithmetic-overflow',
    status: 'valid',
    proof: `pub fn calculate_reward(
    deposit_amount: u64,
    reward_rate: u64,
    duration: u64,
) -> u64 {
    // BUG: unchecked multiplication can overflow
    let reward = deposit_amount * reward_rate * duration;
    reward / PRECISION_FACTOR
}`,
    highlightLines: [134],
    recommendation:
      'Use `checked_mul()` and `checked_div()` for all arithmetic, or use `u128` ' +
      'for intermediate calculations before casting back to `u64`.',
    dedupKey: 'vault|withdraw|arithmetic-overflow',
    notes: 'Confirmed exploitable with deposit amounts > 1e15 lamports.',
    triagedAt: '2026-05-07T10:45:00.000Z',
  },

  {
    id: 'f-004',
    agent: 'accounts-access',
    severity: 'high',
    title: 'PDA seed collision in vault derivation',
    description:
      'The vault PDA is derived using only `[b"vault", authority.key()]` without ' +
      'including the mint. Each authority can only have one vault, and if the program ' +
      'is used with multiple token types, PDA collisions become possible.',
    file: 'programs/vault/src/instructions/initialize.rs',
    line: 18,
    bugClass: 'pda-seed-collision',
    status: 'pending',
    proof: `let (vault_pda, bump) = Pubkey::find_program_address(
    &[
        b"vault",
        authority.key().as_ref(),
        // BUG: mint not included in seeds
    ],
    program_id,
);`,
    highlightLines: [18, 19, 20, 21, 22],
    recommendation:
      'Include `mint.key().as_ref()` in the PDA seeds to ensure unique vaults ' +
      'per authority-mint pair.',
    dedupKey: 'vault|initialize|pda-seed-collision',
  },

  {
    id: 'f-005',
    agent: 'state-lifecycle',
    severity: 'high',
    title: 'Account not closed after full withdrawal',
    description:
      'When a user withdraws their entire balance, the vault account remains open ' +
      'with zero lamports in the token account. An attacker can front-run the ' +
      're-initialization of this "empty" vault to hijack its authority.',
    file: 'programs/vault/src/instructions/withdraw.rs',
    line: 95,
    bugClass: 'account-not-closed',
    status: 'valid',
    proof: `if vault.deposited_amount == 0 {
    // TODO: close the vault account
    // BUG: vault left open with zero balance
    msg!("Vault fully withdrawn");
}`,
    highlightLines: [95, 96, 97],
    recommendation:
      'Use Anchor\'s `close = authority` constraint or manually transfer remaining ' +
      'lamports and zero the account data when the balance reaches zero.',
    dedupKey: 'vault|withdraw|account-not-closed',
    notes: 'Real-world exploit path exists via front-running.',
    triagedAt: '2026-05-07T10:52:00.000Z',
  },

  // ═══ MEDIUM ═══════════════════════════════════════════════════════════════

  {
    id: 'f-006',
    agent: 'arithmetic-economic',
    severity: 'medium',
    title: 'Stale oracle price in liquidation threshold',
    description:
      'The liquidation check uses `oracle_price` without verifying `last_update_slot`. ' +
      'A stale price from network congestion could trigger incorrect liquidations ' +
      'or prevent valid ones.',
    file: 'programs/vault/src/instructions/withdraw.rs',
    line: 156,
    bugClass: 'stale-oracle-data',
    status: 'pending',
    proof: `let oracle_data = OraclePrice::try_from_slice(
    &oracle_account.data.borrow()
)?;
// BUG: no staleness check on oracle timestamp
let current_value = vault.deposited_amount
    .checked_mul(oracle_data.price)
    .ok_or(VaultError::MathOverflow)?;`,
    highlightLines: [156, 157, 158, 159],
    recommendation:
      'Add a staleness check: verify `Clock::get()?.slot - oracle_data.last_update_slot ' +
      '< MAX_ORACLE_STALENESS` before using the price.',
    dedupKey: 'vault|withdraw|stale-oracle-data',
  },

  {
    id: 'f-007',
    agent: 'cpi-token',
    severity: 'medium',
    title: 'Missing token account ownership check in CPI',
    description:
      'The `transfer_tokens` CPI call does not verify that ' +
      '`destination_token_account.owner` matches the expected recipient. ' +
      'A malicious user could pass a token account they control as the destination.',
    file: 'programs/vault/src/instructions/withdraw.rs',
    line: 203,
    bugClass: 'cpi-account-validation',
    status: 'not-important',
    proof: `token::transfer(
    CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
    ),
    amount,
)?;`,
    highlightLines: [207, 208],
    recommendation:
      'Add a constraint `constraint = destination.owner == recipient.key()` to ' +
      'ensure the token account belongs to the intended recipient.',
    dedupKey: 'vault|withdraw|cpi-account-validation',
    notes: 'The downstream token program checks prevent the worst outcome.',
    triageReason: 'not important',
    triagedAt: '2026-05-07T11:02:00.000Z',
  },

  {
    id: 'f-008',
    agent: 'invariant-logic',
    severity: 'medium',
    title: 'Deposit cap bypass via multiple transactions',
    description:
      'The vault enforces a `max_deposit` cap but only checks `amount <= max_deposit` ' +
      'rather than `vault.deposited_amount + amount <= max_deposit`. A user can bypass ' +
      'the cap by splitting their deposit across multiple transactions.',
    file: 'programs/vault/src/instructions/deposit.rs',
    line: 78,
    bugClass: 'invariant-violation',
    status: 'pending',
    proof: `pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // BUG: checks amount alone, not cumulative total
    require!(amount <= vault.max_deposit, VaultError::DepositExceedsCap);

    vault.deposited_amount += amount;
    // ...
}`,
    highlightLines: [82],
    recommendation:
      'Change the check to `require!(vault.deposited_amount.checked_add(amount)' +
      '.unwrap() <= vault.max_deposit, ...)`.',
    dedupKey: 'vault|deposit|invariant-violation',
  },

  // ═══ LOW ══════════════════════════════════════════════════════════════════

  {
    id: 'f-009',
    agent: 'accounts-access',
    severity: 'low',
    title: 'Admin role lacks two-step transfer',
    description:
      'The `update_admin` instruction immediately transfers admin privileges. ' +
      'If the admin sets the wrong address, admin access is permanently lost. ' +
      'Standard practice uses a two-step "propose + accept" pattern.',
    file: 'programs/vault/src/instructions/admin.rs',
    line: 34,
    bugClass: 'access-control-design',
    status: 'pending',
    proof: `pub fn update_admin(
    ctx: Context<UpdateAdmin>,
    new_admin: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = new_admin; // instant transfer, no acceptance step
    Ok(())
}`,
    highlightLines: [39],
    recommendation:
      'Implement a two-step admin transfer: `propose_admin(new_admin)` stores a ' +
      '`pending_admin`, then `accept_admin()` called by the new admin completes it.',
    dedupKey: 'vault|admin|access-control-design',
  },

  {
    id: 'f-010',
    agent: 'state-lifecycle',
    severity: 'low',
    title: 'Rent-exempt check missing on realloc',
    description:
      'When the vault account is reallocated to accommodate additional fields, ' +
      'the instruction does not verify the account maintains rent-exempt status. ' +
      'The runtime will garbage-collect the account if it falls below the threshold.',
    file: 'programs/vault/src/instructions/admin.rs',
    line: 112,
    bugClass: 'rent-exemption',
    status: 'invalid',
    proof: `vault_info.realloc(new_size, false)?;
// BUG: no check that lamports still cover rent-exempt minimum
// after realloc to larger size`,
    highlightLines: [112],
    recommendation:
      'After realloc, transfer additional lamports if needed: ' +
      '`let rent = Rent::get()?; let min = rent.minimum_balance(new_size);`.',
    dedupKey: 'vault|admin|rent-exemption',
    notes: 'Anchor handles this automatically in most cases.',
    triageReason: 'invalid',
    triagedAt: '2026-05-07T11:15:00.000Z',
  },

  // ═══ INFORMATIONAL ════════════════════════════════════════════════════════

  {
    id: 'f-011',
    agent: 'invariant-logic',
    severity: 'informational',
    title: 'Event emission missing for deposit/withdraw',
    description:
      'The deposit and withdraw instructions do not emit Anchor events. ' +
      'Off-chain indexers and monitoring systems cannot track vault activity ' +
      'without parsing transaction logs manually.',
    file: 'programs/vault/src/instructions/deposit.rs',
    line: 95,
    bugClass: 'missing-event-emission',
    status: 'out-of-scope',
    proof: `    vault.deposited_amount += amount;
    vault.last_deposit_ts = Clock::get()?.unix_timestamp;

    // No event emitted here
    // emit!(DepositEvent { vault: vault.key(), amount, user: ... });

    Ok(())
}`,
    highlightLines: [],
    recommendation:
      'Add `#[event]` structs and `emit!()` calls for all state-changing ' +
      'instructions to improve off-chain observability.',
    dedupKey: 'vault|deposit|missing-event-emission',
    triageReason: 'out of scope',
    triagedAt: '2026-05-07T11:20:00.000Z',
  },

  {
    id: 'f-012',
    agent: 'arithmetic-economic',
    severity: 'informational',
    title: 'Precision loss in fee calculation rounds down',
    description:
      'The protocol fee is calculated as `amount * fee_bps / 10000` using integer ' +
      'division, which always rounds down. Over many transactions the protocol ' +
      'collects slightly less in fees than expected.',
    file: 'programs/vault/src/instructions/withdraw.rs',
    line: 178,
    bugClass: 'precision-loss',
    status: 'pending',
    proof: `let fee = amount
    .checked_mul(config.fee_bps as u64)
    .ok_or(VaultError::MathOverflow)?
    .checked_div(10000)
    .ok_or(VaultError::MathOverflow)?;
// rounds down, protocol loses dust on each tx`,
    highlightLines: [178, 179, 180, 181, 182],
    recommendation:
      'Consider rounding up for protocol fees using ' +
      '`(amount * fee_bps + 9999) / 10000`.',
    dedupKey: 'vault|withdraw|precision-loss',
  },
];

write('findings.json', { findings });

// ── Summary ─────────────────────────────────────────────────────────────────

const flag = scanning ? ' (--scanning)' : '';
console.log(`\n  seed complete${flag}: 5 files written to state/\n`);
