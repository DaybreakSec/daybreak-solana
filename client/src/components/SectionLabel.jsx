export default function SectionLabel({ children }) {
  return (
    <span
      className="font-mono text-text-secondary"
      style={{
        fontSize: '14px',
        lineHeight: '1',
        fontWeight: 500,
        letterSpacing: '0.10em',
      }}
    >
      {children}
    </span>
  );
}
