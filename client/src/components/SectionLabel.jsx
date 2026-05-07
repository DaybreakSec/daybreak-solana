export default function SectionLabel({ children }) {
  return (
    <span
      className="font-mono text-text-tertiary"
      style={{
        fontSize: '11px',
        lineHeight: '1',
        fontWeight: 500,
        letterSpacing: '0.12em',
      }}
    >
      {children}
    </span>
  );
}
