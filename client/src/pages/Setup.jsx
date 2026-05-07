import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionLabel from '../components/SectionLabel';
import HorizonMeter from '../components/HorizonMeter';
import ActionButton from '../components/ActionButton';

export default function Setup() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('git');
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [scopeNotes, setScopeNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    fetch('/api/state/audit')
      .then(r => r.json())
      .then(data => {
        if (data) {
          if (data.repoUrl) { setRepoUrl(data.repoUrl); setMode('git'); }
          if (data.localPath) { setLocalPath(data.localPath); setMode('local'); }
          if (data.scopeNotes) setScopeNotes(data.scopeNotes);
        }
      })
      .catch(() => {});

    fetch('/api/state/sanitize')
      .then(r => r.json())
      .then(data => {
        if (data && data.warnings) setWarnings(data.warnings);
      })
      .catch(() => {});
  }, []);

  async function handleStart() {
    setLoading(true);
    const payload = {
      phase: 'setup',
      mode,
      repoUrl: mode === 'git' ? repoUrl : undefined,
      localPath: mode === 'local' ? localPath : undefined,
      scopeNotes,
      startedAt: new Date().toISOString(),
    };
    await fetch('/api/state/audit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    navigate('/scope');
  }

  const inputValue = mode === 'git' ? repoUrl : localPath;
  const setInputValue = mode === 'git' ? setRepoUrl : setLocalPath;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Injection warning banner */}
      {warnings.length > 0 && (
        <div
          className="mb-6 bg-bg-elevated"
          style={{
            border: '0.5px solid var(--color-dawn-magenta)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
          }}
        >
          <SectionLabel>prompt injection detected · review before proceeding</SectionLabel>
          <div className="mt-2 space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="font-mono text-text-secondary" style={{ fontSize: '11px' }}>
                <span className="text-dawn-coral">{w.file}:{w.line}</span>
                <span className="text-text-tertiary"> — {w.pattern}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Page label */}
      <div className="mb-2">
        <SectionLabel>audit setup</SectionLabel>
      </div>

      {/* Display heading */}
      <h1
        className="font-display text-text-primary mb-8"
        style={{
          fontSize: '28px',
          lineHeight: '1.15',
          fontWeight: 500,
          fontStyle: 'italic',
        }}
      >
        a security audit, scoped and run.
      </h1>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-6">
        {['git', 'local'].map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`font-mono cursor-pointer transition-colors duration-150 ${
              mode === m
                ? 'text-text-primary bg-bg-elevated-2/40'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            style={{
              fontSize: '11px',
              letterSpacing: '0.04em',
              padding: '6px 14px',
              borderRadius: '999px',
              border: mode === m
                ? '0.5px solid var(--color-border-strong)'
                : '0.5px solid var(--color-border-default)',
            }}
          >
            {m === 'git' ? 'git repo' : 'local directory'}
          </button>
        ))}
      </div>

      {/* Input field */}
      <div className="mb-4">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder={mode === 'git'
            ? 'https://github.com/org/program.git'
            : '/home/user/projects/my-program'
          }
          className="w-full font-mono text-text-primary bg-bg-elevated placeholder-text-tertiary"
          style={{
            fontSize: '13px',
            padding: '12px 0',
            border: 'none',
            borderBottom: '0.5px solid var(--color-border-default)',
            outline: 'none',
            background: 'transparent',
          }}
          onFocus={e => e.target.style.borderBottomColor = 'var(--color-border-strong)'}
          onBlur={e => e.target.style.borderBottomColor = 'var(--color-border-default)'}
        />
      </div>

      {/* Scope notes */}
      <div className="mb-8">
        <textarea
          value={scopeNotes}
          onChange={e => setScopeNotes(e.target.value)}
          placeholder="additional scope notes / context"
          rows={4}
          className="w-full font-mono text-text-primary bg-bg-elevated placeholder-text-tertiary resize-y"
          style={{
            fontSize: '13px',
            padding: '12px 0',
            border: 'none',
            borderBottom: '0.5px solid var(--color-border-default)',
            outline: 'none',
            background: 'transparent',
            lineHeight: '1.6',
          }}
          onFocus={e => e.target.style.borderBottomColor = 'var(--color-border-strong)'}
          onBlur={e => e.target.style.borderBottomColor = 'var(--color-border-default)'}
        />
      </div>

      {/* Empty horizon meter placeholder */}
      <div className="mb-8">
        <HorizonMeter findings={{}} />
      </div>

      {/* Start button */}
      <ActionButton
        variant="primary"
        onClick={handleStart}
        disabled={loading || (!repoUrl && !localPath)}
        style={{ width: '100%', justifyContent: 'center', padding: '12px 14px' }}
      >
        {loading ? 'starting...' : 'start audit →'}
      </ActionButton>
    </div>
  );
}
