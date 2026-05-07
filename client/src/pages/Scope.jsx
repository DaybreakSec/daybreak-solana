import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionLabel from '../components/SectionLabel';
import ActionButton from '../components/ActionButton';

export default function Scope() {
  const navigate = useNavigate();
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState(new Set());
  const [hoveredFile, setHoveredFile] = useState(null);

  useEffect(() => {
    const poll = setInterval(() => {
      fetch('/api/state/scope')
        .then(r => r.json())
        .then(data => {
          if (data) { setScope(data); setLoading(false); }
        })
        .catch(() => {});
    }, 2000);

    fetch('/api/state/scope')
      .then(r => r.json())
      .then(data => {
        if (data) {
          setScope(data);
          setLoading(false);
          if (data.excludedFiles) setExcluded(new Set(data.excludedFiles));
        }
      })
      .catch(() => {});

    return () => clearInterval(poll);
  }, []);

  function toggleFile(path) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function acceptScope() {
    const updated = {
      ...scope,
      accepted: true,
      excludedFiles: Array.from(excluded),
      acceptedAt: new Date().toISOString(),
    };
    await fetch('/api/state/scope', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    navigate('/audit');
  }

  if (loading) {
    return (
      <div className="text-center py-20">
        <div
          className="inline-block w-2 h-2 rounded-full bg-dawn-magenta"
          style={{ animation: 'scanning-pulse 1600ms ease-in-out infinite' }}
        />
        <p className="font-mono text-text-tertiary mt-4" style={{ fontSize: '11px' }}>
          waiting for scope analysis...
        </p>
        <style>{`
          @keyframes scanning-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }
        `}</style>
      </div>
    );
  }

  if (!scope) {
    return (
      <p className="font-mono text-text-tertiary" style={{ fontSize: '11px' }}>
        no scope data available. start an audit first.
      </p>
    );
  }

  const files = scope.files || [];
  const inScopeFiles = files.filter(f => !excluded.has(f.path));
  const inScopeLoc = inScopeFiles.reduce((sum, f) => sum + f.loc, 0);
  const totalLoc = files.reduce((sum, f) => sum + f.loc, 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <SectionLabel>audit 003 · scope</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
        >
          review scope
        </h1>
        <p className="font-mono text-text-tertiary mt-1" style={{ fontSize: '11px' }}>
          {scope.framework || 'anchor'} · {inScopeLoc.toLocaleString()} loc in scope
        </p>
      </div>

      {/* Treemap */}
      <div
        className="mb-6 bg-bg-elevated overflow-hidden"
        style={{
          borderRadius: 'var(--radius-xl)',
          border: '0.5px solid var(--color-border-default)',
          padding: '2px',
        }}
      >
        <TreeMap
          files={files}
          excluded={excluded}
          hoveredFile={hoveredFile}
          onHover={setHoveredFile}
          onToggle={toggleFile}
        />
      </div>

      {/* Excluded files list */}
      {excluded.size > 0 && (
        <div className="mb-6">
          <SectionLabel>excluded files</SectionLabel>
          <div className="mt-2 space-y-1">
            {Array.from(excluded).map(path => (
              <div key={path} className="flex items-center gap-2">
                <span className="font-mono text-text-tertiary" style={{ fontSize: '11px' }}>
                  {path}
                </span>
                <button
                  type="button"
                  onClick={() => toggleFile(path)}
                  className="font-mono text-dawn-amber cursor-pointer"
                  style={{ fontSize: '10px' }}
                >
                  re-include
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex items-center gap-3">
        <ActionButton onClick={() => navigate('/')}>re-scan</ActionButton>
        <ActionButton variant="primary" onClick={acceptScope}>
          accept scope →
        </ActionButton>
      </div>
    </div>
  );
}

// Simple treemap: rectangles proportional to LOC in a flex-wrap layout
function TreeMap({ files, excluded, hoveredFile, onHover, onToggle }) {
  const maxLoc = Math.max(...files.map(f => f.loc), 1);

  return (
    <div className="flex flex-wrap" style={{ minHeight: '180px' }}>
      {files.map(f => {
        const isExcluded = excluded.has(f.path);
        const isHovered = hoveredFile === f.path;
        // size proportional to LOC, min 40px
        const size = Math.max(40, Math.sqrt(f.loc / maxLoc) * 120);

        return (
          <div
            key={f.path}
            role="button"
            tabIndex={0}
            className="relative cursor-pointer transition-colors duration-150"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              flexGrow: f.loc,
              background: isExcluded
                ? 'var(--color-bg-elevated)'
                : isHovered
                  ? 'var(--color-bg-elevated-2)'
                  : 'var(--color-bg-elevated)',
              border: '0.5px solid var(--color-border-subtle)',
              borderRadius: '2px',
              opacity: isExcluded ? 0.4 : 1,
            }}
            onMouseEnter={() => onHover(f.path)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onToggle(f.path)}
            onKeyDown={e => { if (e.key === 'Enter') onToggle(f.path); }}
          >
            {/* Diagonal hatch for excluded */}
            {isExcluded && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                <pattern id={`hatch-${f.path}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-text-tertiary)" strokeWidth="0.5" strokeOpacity="0.3" />
                </pattern>
                <rect width="100%" height="100%" fill={`url(#hatch-${f.path})`} />
              </svg>
            )}

            {/* Tooltip on hover */}
            {isHovered && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-bg-recessed font-mono text-text-primary whitespace-nowrap z-10"
                style={{
                  fontSize: '10px',
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid var(--color-border-default)',
                }}
              >
                {f.path} · {f.loc} loc
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
