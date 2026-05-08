import { useEffect, useRef, useState } from 'react';
import SeverityBadge from './SeverityBadge';

export default function FindingCard({ finding, selected = false, muted = false, onClick, onDragStart, checkbox = false, checked = false }) {
  const [pulsing, setPulsing] = useState(false);
  const mountedAt = useRef(Date.now());

  // untriaged-too-long pulse: if pending and >30s, pulse once
  useEffect(() => {
    if (finding.status !== 'pending') return;
    const timer = setTimeout(() => {
      setPulsing(true);
      // stop after one cycle (1200ms)
      setTimeout(() => setPulsing(false), 1200);
    }, 30000 - (Date.now() - mountedAt.current));
    return () => clearTimeout(timer);
  }, [finding.status]);

  const isDismissed = finding.status === 'invalid'
    || finding.status === 'not-important'
    || finding.status === 'out-of-scope';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', finding.id);
        onDragStart?.(finding);
      }}
      className="cursor-pointer transition-colors duration-150"
      style={{
        background: selected
          ? 'var(--color-bg-elevated-2)'
          : 'var(--color-bg-elevated)',
        border: selected
          ? '0.5px solid rgba(232, 90, 140, 0.4)'
          : '0.5px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '10px 12px',
        marginBottom: '7px',
        opacity: muted ? 0.7 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        animation: pulsing
          ? 'finding-pulse 1200ms ease-in-out 1'
          : 'none',
      }}
    >
      <div className="flex items-center gap-1.5">
        {checkbox && (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="accent-[var(--color-dawn-amber)] mr-1"
            style={{ flexShrink: 0 }}
          />
        )}
        <SeverityBadge severity={finding.severity} />
        {finding.confidence && (
          <span
            className="font-mono"
            style={{
              fontSize: '12px',
              letterSpacing: '0.06em',
              padding: '1px 5px',
              borderRadius: '999px',
              color: finding.confidence === 'high'
                ? 'var(--color-text-secondary)'
                : 'var(--color-text-tertiary)',
              border: '0.5px solid var(--color-border-subtle)',
            }}
          >
            {finding.confidence}
          </span>
        )}
        {finding.validation && (
          <span
            className="font-mono"
            style={{
              fontSize: '12px',
              letterSpacing: '0.06em',
              padding: '1px 5px',
              borderRadius: '999px',
              color: finding.validation.verdict === 'confirmed'
                ? 'var(--color-dawn-gold)'
                : finding.validation.verdict === 'refuted'
                  ? 'var(--color-dawn-coral)'
                  : 'var(--color-text-tertiary)',
              border: `0.5px solid ${
                finding.validation.verdict === 'confirmed'
                  ? 'rgba(232, 178, 56, 0.3)'
                  : finding.validation.verdict === 'refuted'
                    ? 'rgba(232, 90, 90, 0.3)'
                    : 'var(--color-border-subtle)'
              }`,
            }}
          >
            {finding.validation.verdict}
          </span>
        )}
      </div>

      <span
        className="font-display text-text-primary"
        style={{
          fontSize: '17px',
          lineHeight: '1.35',
          fontWeight: 500,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {finding.title}
      </span>

      {isDismissed ? (
        <span
          className="font-mono text-text-tertiary"
          style={{ fontSize: '13px' }}
        >
          {finding.triageReason || finding.status?.replace('-', ' ')}
        </span>
      ) : (
        <span
          className="font-mono text-text-tertiary"
          style={{
            fontSize: '13px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
            direction: 'rtl',
            textAlign: 'left',
          }}
        >
          <bdi>{finding.file}{finding.line != null ? `:${finding.line}` : ''}</bdi>
        </span>
      )}

      <style>{`
        @keyframes finding-pulse {
          0%, 100% { border-color: var(--color-border-subtle); }
          50% { border-color: rgba(232, 90, 140, 0.5); }
        }
      `}</style>
    </div>
  );
}
