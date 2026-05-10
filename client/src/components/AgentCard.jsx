import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SectionLabel from './SectionLabel';
import { formatDuration, formatTokens, formatCost } from '../utils/format';

const statusColors = {
  scanning: 'var(--color-dawn-magenta)',
  running: 'var(--color-dawn-magenta)',
  complete: 'var(--color-text-secondary)',
  completed: 'var(--color-text-secondary)',
  queued: 'var(--color-text-tertiary)',
  pending: 'var(--color-text-tertiary)',
  error: 'var(--color-dawn-coral)',
};

const severityDotColors = {
  critical: 'var(--color-sev-critical)',
  high: 'var(--color-sev-high)',
  medium: 'var(--color-sev-medium)',
  low: 'var(--color-sev-low)',
  info: 'var(--color-sev-info)',
  informational: 'var(--color-sev-info)',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info', 'informational'];

const BASE_CARD_STYLE = {
  borderRadius: 'var(--radius-xl)',
  padding: '14px 16px',
  minHeight: '138px',
  gap: '10px',
  transition: 'border-color 200ms ease, transform 200ms ease',
};
const CARD_BORDER_ACTIVE = '0.5px solid rgba(232, 90, 140, 0.35)';
const CARD_BORDER_IDLE = '0.5px solid var(--color-border-subtle)';

function normalizeStatus(s) {
  if (!s) return 'queued';
  return s.toLowerCase();
}

/** Build a tally string like "1c 2h 3m" and pick the top 3 severity dots. */
function buildSeveritySummary(findings) {
  const counts = {};
  for (const f of findings) {
    const s = (f.severity || 'info').toLowerCase();
    counts[s] = (counts[s] || 0) + 1;
  }

  // Tally parts
  const parts = [];
  if (counts.critical) parts.push(`${counts.critical}c`);
  if (counts.high) parts.push(`${counts.high}h`);
  if (counts.medium) parts.push(`${counts.medium}m`);
  if (counts.low) parts.push(`${counts.low}l`);
  if (counts.info || counts.informational) parts.push(`${(counts.info || 0) + (counts.informational || 0)}i`);

  // Top 3 dots colored by highest severity
  const dots = [];
  for (const sev of SEVERITY_ORDER) {
    const c = counts[sev] || 0;
    for (let i = 0; i < c && dots.length < 3; i++) {
      dots.push(sev);
    }
    if (dots.length >= 3) break;
  }

  return { tally: parts.join(' '), dots };
}

/** Local elapsed timer — only ticks when the agent is actively scanning. */
function useElapsedTimer(startedAt, isActive) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Date.now() - new Date(startedAt).getTime() : 0
  );

  useEffect(() => {
    if (!isActive || !startedAt) return;
    setElapsed(Date.now() - new Date(startedAt).getTime());
    const interval = setInterval(() => {
      setElapsed(Date.now() - new Date(startedAt).getTime());
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive, startedAt]);

  return elapsed;
}

export default function AgentCard({
  agent,
  agentKey,
  index = 0,
  findings = [],
  tokenBudget = 0,
  costUsd,
  maxTokensAcrossAgents = 0,
}) {
  const status = normalizeStatus(agent.status);
  const isActive = status === 'scanning' || status === 'running';
  const isComplete = status === 'complete' || status === 'completed';

  const elapsed = useElapsedTimer(agent.startedAt, isActive);

  const statusLabel = isActive ? 'scanning' : isComplete ? 'complete' : status;
  const statusColor = statusColors[status] || statusColors.queued;

  const metaText = isActive
    ? (agent.currentFile || `scanning (${formatDuration(elapsed)})`)
    : isComplete
      ? formatDuration(agent.durationMs)
      : status === 'queued'
        ? 'awaiting earlier phases'
        : 'awaiting structural data';

  // Token bar baseline: use maxTokensAcrossAgents when available, else fall back
  const tokenBaseline = maxTokensAcrossAgents > 0
    ? maxTokensAcrossAgents
    : tokenBudget > 0
      ? tokenBudget / 5
      : 0;

  const { tally, dots } = buildSeveritySummary(findings);

  // Per-agent cost: prefer explicit prop, fall back to agent data
  const agentCost = costUsd ?? agent.costUsd ?? 0;

  const cardContent = (
    <>
      {/* Top row: agent number + status */}
      <div className="flex items-center justify-between">
        <SectionLabel>agent {String(index + 1).padStart(2, '0')}</SectionLabel>
        <span
          className="font-mono inline-flex items-center gap-1.5"
          style={{
            fontSize: '13px',
            color: statusColor,
          }}
        >
          {isActive && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: statusColor,
                animation: 'scanning-pulse 1600ms ease-in-out infinite',
              }}
            />
          )}
          {statusLabel}
        </span>
      </div>

      {/* Agent title */}
      <span
        className="font-display text-text-primary"
        style={{
          fontSize: '17px',
          lineHeight: '1.35',
          fontWeight: 500,
        }}
      >
        {agent.name}
      </span>

      {/* Currently examining / duration */}
      <span
        className="font-mono text-text-tertiary truncate"
        style={{ fontSize: '13px' }}
      >
        {metaText}
      </span>

      {/* Token usage row */}
      {agent.tokensUsed != null && tokenBaseline > 0 && (
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-text-tertiary"
            style={{ fontSize: '13px' }}
          >
            {formatTokens(agent.tokensUsed)} tokens{agentCost ? ` \u00b7 ${formatCost(agentCost)}` : ''}
          </span>
          <div
            className="flex-1 overflow-hidden"
            style={{
              height: '3px',
              borderRadius: '1.5px',
              background: 'var(--color-bg-recessed)',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, (agent.tokensUsed / tokenBaseline) * 100)}%`,
                height: '100%',
                borderRadius: '1.5px',
                background: agent.tokensUsed / tokenBaseline > 0.8
                  ? 'var(--color-dawn-coral)'
                  : 'var(--color-dawn-gold)',
                transition: 'width 300ms ease-out',
              }}
            />
          </div>
        </div>
      )}

      {/* Findings dots (max 3) + tally */}
      <div className="flex items-center gap-1.5 mt-auto">
        <div className="flex items-center gap-0.5">
          {dots.map((sev, i) => (
            <span
              key={i}
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: severityDotColors[sev] || severityDotColors.info,
              }}
            />
          ))}
        </div>
        <span
          className="font-mono text-text-tertiary"
          style={{ fontSize: '13px' }}
        >
          {findings.length} finding{findings.length !== 1 ? 's' : ''}
          {tally ? ` \u00b7 ${tally}` : ''}
        </span>
      </div>

      {/* "view findings" CTA when complete */}
      {isComplete && (
        <span
          className="font-mono"
          style={{
            fontSize: '12px',
            color: 'var(--color-dawn-amber)',
            letterSpacing: '0.02em',
          }}
        >
          view findings &rarr;
        </span>
      )}
    </>
  );

  const sharedStyle = {
    ...BASE_CARD_STYLE,
    border: isActive ? CARD_BORDER_ACTIVE : CARD_BORDER_IDLE,
  };

  if (isComplete && agentKey) {
    return (
      <Link
        to={`/findings?agent=${agentKey}`}
        className="flex flex-col bg-bg-elevated no-underline"
        style={sharedStyle}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--color-card-hover-border)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div
      className="flex flex-col bg-bg-elevated"
      style={sharedStyle}
    >
      {cardContent}
    </div>
  );
}
