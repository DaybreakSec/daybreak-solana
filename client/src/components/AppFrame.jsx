import { NavLink } from 'react-router-dom';
import SawatchFooter from './SawatchFooter';

const navItems = [
  { to: '/', label: 'setup', end: true },
  { to: '/scope', label: 'scope' },
  { to: '/audit', label: 'audit' },
  { to: '/findings', label: 'findings' },
  { to: '/export', label: 'export' },
];

const statusConfig = {
  idle: { dot: null, label: 'idle' },
  scanning: { dot: 'var(--color-dawn-magenta)', label: 'scanning', pulse: true },
  triage: { dot: 'var(--color-dawn-gold)', label: 'triage' },
  complete: { dot: 'var(--color-dawn-cream)', label: 'complete' },
};

export default function AppFrame({ children, status = 'idle' }) {
  const st = statusConfig[status] || statusConfig.idle;

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--color-bg-base)' }}>
      {/* Top nav */}
      <nav
        className="flex items-center justify-between"
        style={{
          height: '56px',
          padding: '0 1.5rem',
          borderBottom: '0.5px solid var(--color-border-subtle)',
        }}
      >
        {/* Left: brand + nav links */}
        <div className="flex items-center gap-4">
          {/* Brand */}
          <div className="flex items-center gap-1.5">
            <span
              className="font-display text-text-primary"
              style={{ fontSize: '18px', fontWeight: 500 }}
            >
              daybreak
            </span>
            <span className="text-text-tertiary" style={{ fontSize: '14px' }}>/</span>
            <span
              className="font-mono text-text-tertiary"
              style={{ fontSize: '13px', letterSpacing: '0.04em' }}
            >
              solana auditor
            </span>
          </div>

          {/* Nav links */}
          <div
            className="flex items-center gap-1 ml-4"
            style={{ borderLeft: '0.5px solid var(--color-border-subtle)', paddingLeft: '16px' }}
          >
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `font-mono transition-colors duration-150 ${
                    isActive ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                  }`
                }
                style={{
                  fontSize: '13px',
                  fontWeight: 400,
                  letterSpacing: '0.04em',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>

        {/* Right: status */}
        <div className="flex items-center gap-2">
          {st.dot && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: st.dot,
                animation: st.pulse ? 'scanning-pulse 1600ms ease-in-out infinite' : 'none',
              }}
            />
          )}
          <span
            className="font-mono text-text-tertiary"
            style={{ fontSize: '13px', letterSpacing: '0.04em' }}
          >
            {st.label}
          </span>
        </div>
      </nav>

      {/* Main content */}
      <main
        className="relative"
        style={{
          padding: '1.5rem 1.75rem 6rem',
          zIndex: 1,
        }}
      >
        {children}
      </main>

      {/* Sawatch footer */}
      <SawatchFooter />

      <style>{`
        @keyframes scanning-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
