export default function ActionButton({ children, variant = 'default', onClick, ...props }) {
  const isPrimary = variant === 'primary';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center font-mono cursor-pointer
        transition-colors duration-150
        ${isPrimary
          ? 'text-dawn-gold hover:bg-[rgba(245,166,91,0.22)]'
          : 'text-text-primary hover:bg-bg-elevated-2'
        }
      `}
      style={{
        fontSize: '11px',
        fontWeight: 500,
        letterSpacing: '0.04em',
        padding: '8px 14px',
        borderRadius: 'var(--radius-md)',
        borderWidth: '0.5px',
        borderStyle: 'solid',
        borderColor: isPrimary
          ? 'rgba(245, 166, 91, 0.5)'
          : 'var(--color-border-strong)',
        background: isPrimary
          ? 'rgba(245, 166, 91, 0.14)'
          : 'transparent',
      }}
      {...props}
    >
      {children}
    </button>
  );
}
