import SectionLabel from './SectionLabel';

const segments = [
  { key: 'critical', bg: 'var(--color-sev-critical)', text: 'var(--color-sev-critical-text)' },
  { key: 'high',     bg: 'var(--color-sev-high)',     text: 'var(--color-sev-high-text)' },
  { key: 'medium',   bg: 'var(--color-sev-medium)',   text: 'var(--color-sev-medium-text)' },
  { key: 'low',      bg: 'var(--color-sev-low)',      text: 'var(--color-sev-low-text)' },
];

export default function HorizonMeter({ findings = {}, totalLoc = 2847 }) {
  // findings: { critical: n, high: n, medium: n, low: n }
  const counts = {
    critical: findings.critical || 0,
    high: findings.high || 0,
    medium: findings.medium || 0,
    low: findings.low || 0,
  };

  const total = counts.critical + counts.high + counts.medium + counts.low;
  const remaining = Math.min(12, Math.max(4, Math.floor(totalLoc / 1000)));

  // summary string
  const parts = [];
  parts.push(`${total} finding${total !== 1 ? 's' : ''}`);
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  if (counts.low) parts.push(`${counts.low} low`);

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>aggregate risk · horizon</SectionLabel>
        <span
          className="font-mono text-text-secondary"
          style={{ fontSize: '11px' }}
        >
          {parts.join(' · ')}
        </span>
      </div>

      {/* Meter bar */}
      <div
        className="flex overflow-hidden bg-bg-elevated"
        style={{
          height: '36px',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {segments.map(seg => {
          const count = counts[seg.key];
          if (!count) return null;
          return (
            <div
              key={seg.key}
              className="flex items-center justify-center font-mono transition-all duration-300 ease-out"
              style={{
                flex: count,
                background: seg.bg,
                color: seg.text,
                fontSize: '11px',
                fontWeight: 500,
                minWidth: count ? '28px' : 0,
              }}
            >
              {count}
            </div>
          );
        })}
        <div
          className="bg-bg-elevated"
          style={{ flex: remaining }}
        />
      </div>

      {/* Footer labels */}
      <div className="flex items-center justify-between mt-1.5">
        <span
          className="font-mono text-text-tertiary"
          style={{ fontSize: '11px' }}
        >
          pre-dawn
        </span>
        <span
          className="font-mono text-text-tertiary"
          style={{ fontSize: '11px' }}
        >
          daybreak
        </span>
      </div>
    </div>
  );
}
