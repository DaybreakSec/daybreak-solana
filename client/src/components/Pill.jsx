const severityDotColors = {
  critical: 'bg-sev-critical',
  high: 'bg-sev-high',
  medium: 'bg-sev-medium',
  low: 'bg-sev-low',
  info: 'bg-sev-info',
};

export default function Pill({ children, active = false, severity, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 font-mono rounded-full cursor-pointer
        transition-colors duration-150
        ${active
          ? 'bg-bg-elevated/40 border-border-strong text-text-primary'
          : 'bg-transparent border-border-default text-text-secondary hover:bg-bg-elevated-2/40'
        }
      `}
      style={{
        fontSize: '11px',
        fontWeight: 400,
        padding: '5px 11px',
        borderWidth: '0.5px',
        borderStyle: 'solid',
      }}
    >
      {severity && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${severityDotColors[severity] || ''}`}
        />
      )}
      {children}
      {count != null && (
        <span className="text-text-tertiary">{count}</span>
      )}
    </button>
  );
}
