const styles = {
  critical: { background: 'var(--color-sev-critical)', color: 'var(--color-sev-critical-text)' },
  high:     { background: 'var(--color-sev-high)',     color: 'var(--color-sev-high-text)' },
  medium:   { background: 'var(--color-sev-medium)',   color: 'var(--color-sev-medium-text)' },
  low:      { background: 'var(--color-sev-low)',      color: 'var(--color-sev-low-text)' },
  info:     { background: 'var(--color-sev-info)',     color: 'var(--color-sev-info-text)' },
};

function normalizeSeverity(sev) {
  if (!sev) return 'info';
  const s = sev.toLowerCase();
  if (s === 'informational') return 'info';
  return s;
}

export default function SeverityBadge({ severity }) {
  const key = normalizeSeverity(severity);
  const sev = styles[key] || styles.info;

  return (
    <span
      className="font-mono inline-block"
      style={{
        fontSize: '13px',
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        ...sev,
      }}
    >
      {key === 'info' ? 'informational' : key}
    </span>
  );
}
