import SectionLabel from './SectionLabel';

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

function normalizeStatus(s) {
  if (!s) return 'queued';
  return s.toLowerCase();
}

export default function AgentCard({ agent, index = 0, findings = [] }) {
  const status = normalizeStatus(agent.status);
  const isActive = status === 'scanning' || status === 'running';
  const isComplete = status === 'complete' || status === 'completed';

  const statusLabel = isActive ? 'scanning' : isComplete ? 'complete' : status;
  const statusColor = statusColors[status] || statusColors.queued;

  const metaText = isActive
    ? (agent.currentFile || 'analyzing...')
    : isComplete
      ? (agent.duration || 'finished')
      : 'awaiting structural data';

  return (
    <div
      className="flex flex-col bg-bg-elevated"
      style={{
        border: isActive
          ? '0.5px solid rgba(232, 90, 140, 0.35)'
          : '0.5px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-xl)',
        padding: '14px 16px',
        minHeight: '138px',
        gap: '10px',
      }}
    >
      {/* Top row: agent number + status */}
      <div className="flex items-center justify-between">
        <SectionLabel>agent {String(index + 1).padStart(2, '0')}</SectionLabel>
        <span
          className="font-mono inline-flex items-center gap-1.5"
          style={{
            fontSize: '11px',
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
          fontSize: '15px',
          lineHeight: '1.35',
          fontWeight: 500,
        }}
      >
        {agent.name}
      </span>

      {/* Currently examining / status line */}
      <span
        className="font-mono text-text-tertiary truncate"
        style={{ fontSize: '11px' }}
      >
        {metaText}
      </span>

      {/* Findings dots + count */}
      <div className="flex items-center gap-1.5 mt-auto">
        <div className="flex items-center gap-0.5">
          {findings.slice(0, 20).map((f, i) => (
            <span
              key={i}
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: severityDotColors[f.severity?.toLowerCase()] || severityDotColors.info,
              }}
            />
          ))}
        </div>
        <span
          className="font-mono text-text-tertiary"
          style={{ fontSize: '11px' }}
        >
          {findings.length} finding{findings.length !== 1 ? 's' : ''}
        </span>
      </div>

      <style>{`
        @keyframes scanning-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
