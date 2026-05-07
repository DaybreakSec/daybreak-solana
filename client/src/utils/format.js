/**
 * Shared formatting utilities used across Audit, AgentCard, and TokenBudgetMeter.
 */

/** Format milliseconds as mm:ss (zero-padded). */
export function formatDuration(ms) {
  if (!ms || ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Format USD cost as "$0.92". */
export function formatCost(usd) {
  if (!usd) return '';
  return `$${usd.toFixed(2)}`;
}

/** Format token count as "7.5K" / "1.2M". */
export function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}
