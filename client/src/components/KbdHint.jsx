export default function KbdHint({ shortcut, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd
        className="font-mono text-text-secondary bg-[rgba(245,239,230,0.08)] border-border-default"
        style={{
          fontSize: '10.5px',
          padding: '2px 6px',
          borderRadius: '3px',
          borderWidth: '0.5px',
          borderStyle: 'solid',
        }}
      >
        {shortcut}
      </kbd>
      <span
        className="font-mono text-text-tertiary"
        style={{ fontSize: '10.5px' }}
      >
        {label}
      </span>
    </span>
  );
}
