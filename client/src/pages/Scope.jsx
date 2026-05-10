import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionLabel from '../components/SectionLabel';
import ActionButton from '../components/ActionButton';
import { useToast } from '../components/Toast';
import { useRequireState } from '../hooks/useRouteGuard';
import { pageHeadingStyle } from '../styles/shared';

export default function Scope() {
  const navigate = useNavigate();
  const toast = useToast();
  const { loading: guardLoading } = useRequireState('audit', '/');
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState(new Set());
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/state/audit').then(r => r.json()).then(data => {
      if (data) setAudit(data);
    }).catch(err => {
      setError('Failed to load audit config: ' + err.message);
      toast('Failed to load audit config', 'error');
    });
  }, []);

  useEffect(() => {
    let active = true;
    let abortController = null;

    function fetchScope() {
      if (abortController) abortController.abort();
      abortController = new AbortController();

      fetch('/api/state/scope', { signal: abortController.signal })
        .then(r => {
          if (!r.ok) throw new Error(`Server returned ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (!active) return;
          if (data) {
            setScope(data);
            setLoading(false);
            if (data.excludedFiles) setExcluded(new Set(data.excludedFiles));
          }
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          if (active) setError('Failed to load scope: ' + err.message);
        });
    }

    fetchScope();
    const poll = setInterval(fetchScope, 2000);
    return () => {
      active = false;
      clearInterval(poll);
      if (abortController) abortController.abort();
    };
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

    try {
      const putRes = await fetch('/api/state/scope', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!putRes.ok) {
        toast('Failed to save scope', 'error');
        return;
      }
    } catch (err) {
      toast('Failed to save scope: ' + err.message, 'error');
      return;
    }

    try {
      const res = await fetch('/api/scan/start', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Failed to start scan', 'error');
        return;
      }
    } catch (e) {
      toast('Failed to start scan: ' + e.message, 'error');
      return;
    }

    navigate('/audit');
  }

  if (loading) {
    return (
      <div className="text-center py-20">
        {error ? (
          <>
            <p className="font-mono text-dawn-coral" style={{ fontSize: '13px' }}>
              {error}
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="font-mono text-dawn-amber mt-4 cursor-pointer"
              style={{ fontSize: '13px' }}
            >
              ← back to setup
            </button>
          </>
        ) : (
          <>
            <div
              className="inline-block w-2 h-2 rounded-full bg-dawn-magenta"
              style={{ animation: 'scanning-pulse 1600ms ease-in-out infinite' }}
            />
            <p className="font-mono text-text-tertiary mt-4" style={{ fontSize: '13px' }}>
              waiting for scope analysis...
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="font-mono text-text-tertiary mt-2 cursor-pointer hover:text-text-secondary"
              style={{ fontSize: '13px' }}
            >
              ← back to setup
            </button>
          </>
        )}
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
      <p className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
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
        <SectionLabel>audit · {audit?.repoUrl?.split('/').pop()?.replace('.git', '') || audit?.localPath?.split('/').pop() || 'scope'}</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={pageHeadingStyle}
        >
          review scope
        </h1>
        <p className="font-mono text-text-tertiary mt-1" style={{ fontSize: '13px' }}>
          {scope.framework || 'anchor'} · {inScopeLoc.toLocaleString()} loc in scope
        </p>
      </div>

      {/* File list */}
      <div
        className="mb-6 bg-bg-elevated overflow-hidden"
        style={{
          borderRadius: 'var(--radius-xl)',
          border: '0.5px solid var(--color-border-default)',
        }}
      >
        {files.map((f, i) => {
          const isExcluded = excluded.has(f.path);
          return (
            <div
              key={f.path}
              role="button"
              tabIndex={0}
              className="flex items-center justify-between cursor-pointer transition-colors duration-150 hover:bg-bg-elevated-2/40"
              style={{
                padding: '10px 16px',
                borderBottom: i < files.length - 1 ? '0.5px solid var(--color-border-subtle)' : 'none',
                opacity: isExcluded ? 0.4 : 1,
              }}
              onClick={() => toggleFile(f.path)}
              onKeyDown={e => { if (e.key === 'Enter') toggleFile(f.path); }}
            >
              <span className="font-mono text-text-primary" style={{ fontSize: '13px' }}>
                {f.path}
              </span>
              <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
                {f.loc.toLocaleString()} loc
              </span>
            </div>
          );
        })}
      </div>

      {/* Excluded files list */}
      {excluded.size > 0 && (
        <div className="mb-6">
          <SectionLabel>excluded files</SectionLabel>
          <div className="mt-2 space-y-1">
            {Array.from(excluded).map(path => (
              <div key={path} className="flex items-center gap-2">
                <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
                  {path}
                </span>
                <button
                  type="button"
                  onClick={() => toggleFile(path)}
                  className="font-mono text-dawn-amber cursor-pointer"
                  style={{ fontSize: '12px' }}
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
