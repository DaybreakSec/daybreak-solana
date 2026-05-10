import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionLabel from '../components/SectionLabel';
import ActionButton from '../components/ActionButton';
import { useToast } from '../components/Toast';

export default function Setup() {
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState('git');
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [scopeNotes, setScopeNotes] = useState('');
  const [tokenBudget, setTokenBudget] = useState(1000000);
  const [model, setModel] = useState('sonnet');
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [inputError, setInputError] = useState('');
  // Filesystem browser state
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('/');
  const [browseDirs, setBrowseDirs] = useState([]);
  const [browseIndicators, setBrowseIndicators] = useState({});
  const [browseParent, setBrowseParent] = useState('/');
  const [browseLoading, setBrowseLoading] = useState(false);

  useEffect(() => {
    fetch('/api/state/audit')
      .then(r => r.json())
      .then(data => {
        if (data) {
          if (data.repoUrl) { setRepoUrl(data.repoUrl); setMode('git'); }
          if (data.localPath) { setLocalPath(data.localPath); setMode('local'); }
          if (data.scopeNotes) setScopeNotes(data.scopeNotes);
          if (data.maxTokenBudget) setTokenBudget(data.maxTokenBudget);
          if (data.model) setModel(data.model);
        }
      })
      .catch(err => toast('Failed to load audit state: ' + err.message, 'error'));

    fetch('/api/state/sanitize')
      .then(r => r.json())
      .then(data => {
        if (data && data.warnings) setWarnings(data.warnings);
      })
      .catch(() => { /* sanitize may not exist yet, not an error */ });
  }, []);

  const fetchBrowse = useCallback((dir) => {
    setBrowseLoading(true);
    fetch(`/api/scan/browse?dir=${encodeURIComponent(dir)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          toast(data.error, 'error');
          return;
        }
        setBrowsePath(data.path);
        setBrowseDirs(data.dirs || []);
        setBrowseIndicators(data.indicators || {});
        setBrowseParent(data.parent);
      })
      .catch(err => toast('Failed to browse: ' + err.message, 'error'))
      .finally(() => setBrowseLoading(false));
  }, []);

  function openBrowser() {
    setBrowseOpen(true);
    fetchBrowse(localPath || '/home');
  }

  function selectDir(dir) {
    const newPath = browsePath === '/' ? `/${dir}` : `${browsePath}/${dir}`;
    fetchBrowse(newPath);
  }

  function confirmBrowseSelection() {
    setLocalPath(browsePath);
    setBrowseOpen(false);
  }

  async function handleStart() {
    setInputError('');

    if (mode === 'git') {
      if (!/^https:\/\//.test(repoUrl)) {
        setInputError('Repository URL must start with https://');
        return;
      }
    } else {
      if (!localPath.startsWith('/')) {
        setInputError('Local path must be an absolute path');
        return;
      }
      if (localPath.includes('..')) {
        setInputError('Local path must not contain ".."');
        return;
      }
    }

    setLoading(true);
    const payload = {
      phase: 'setup',
      mode,
      repoUrl: mode === 'git' ? repoUrl : undefined,
      localPath: mode === 'local' ? localPath : undefined,
      scopeNotes,
      maxTokenBudget: tokenBudget,
      model,
      startedAt: new Date().toISOString(),
    };

    try {
      const putRes = await fetch('/api/state/audit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}));
        setInputError(err.error || 'Failed to save audit configuration');
        setLoading(false);
        return;
      }

      const scopeRes = await fetch('/api/scan/scope', { method: 'POST' });
      if (!scopeRes.ok) {
        const err = await scopeRes.json().catch(() => ({}));
        setInputError(err.error || 'Failed to start scope analysis');
        setLoading(false);
        return;
      }
    } catch (err) {
      setInputError(err.message || 'Network error');
      setLoading(false);
      return;
    }

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
              <div key={i} className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
                <span className="text-dawn-coral">{w.file}:{w.line}</span>
                <span className="text-text-tertiary">: {w.pattern}</span>
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
              fontSize: '14px',
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
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={mode === 'git'
              ? 'https://github.com/org/program.git'
              : '/home/user/projects/my-program'
            }
            className="flex-1 font-mono text-text-primary bg-bg-elevated placeholder-text-tertiary"
            style={{
              fontSize: '14px',
              padding: '12px 0',
              border: 'none',
              borderBottom: '0.5px solid var(--color-border-default)',
              outline: 'none',
              background: 'transparent',
            }}
            onFocus={e => e.target.style.borderBottomColor = 'var(--color-border-strong)'}
            onBlur={e => e.target.style.borderBottomColor = 'var(--color-border-default)'}
          />
          {mode === 'local' && (
            <button
              type="button"
              onClick={openBrowser}
              className="font-mono text-text-tertiary hover:text-text-secondary cursor-pointer shrink-0"
              style={{
                fontSize: '13px',
                padding: '6px 10px',
                border: '0.5px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
              }}
            >
              browse
            </button>
          )}
        </div>
      </div>

      {/* Filesystem browser */}
      {mode === 'local' && browseOpen && (
        <div
          className="mb-6 bg-bg-elevated"
          style={{
            borderRadius: 'var(--radius-lg)',
            border: '0.5px solid var(--color-border-default)',
            padding: '12px 14px',
          }}
        >
          {/* Current path header */}
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
              {browsePath}
            </span>
            <div className="flex items-center gap-2">
              {/* Project indicators */}
              {browseIndicators.hasCargo && (
                <span className="font-mono text-dawn-gold" style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '999px', border: '0.5px solid rgba(245, 215, 142, 0.3)' }}>
                  Cargo.toml
                </span>
              )}
              {browseIndicators.hasAnchor && (
                <span className="font-mono text-dawn-amber" style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '999px', border: '0.5px solid rgba(245, 166, 91, 0.3)' }}>
                  Anchor
                </span>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div
            className="space-y-0.5 overflow-y-auto"
            style={{ maxHeight: '200px' }}
          >
            {/* Parent directory link */}
            {browsePath !== '/' && (
              <button
                type="button"
                onClick={() => fetchBrowse(browseParent)}
                className="w-full text-left font-mono text-text-tertiary hover:text-text-secondary cursor-pointer"
                style={{ fontSize: '13px', padding: '4px 6px' }}
              >
                ..
              </button>
            )}

            {browseLoading ? (
              <p className="font-mono text-text-tertiary py-3 text-center" style={{ fontSize: '13px' }}>
                loading...
              </p>
            ) : browseDirs.length === 0 ? (
              <p className="font-mono text-text-tertiary py-3 text-center" style={{ fontSize: '13px' }}>
                no subdirectories
              </p>
            ) : (
              browseDirs.map(dir => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => selectDir(dir)}
                  className="w-full text-left font-mono text-text-secondary hover:text-text-primary cursor-pointer hover:bg-bg-elevated-2/30 transition-colors duration-100"
                  style={{
                    fontSize: '13px',
                    padding: '4px 6px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {dir}/
                </button>
              ))
            )}
          </div>

          {/* Select / close buttons */}
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '0.5px solid var(--color-border-subtle)' }}>
            <ActionButton onClick={confirmBrowseSelection} variant="primary">
              select this directory
            </ActionButton>
            <button
              type="button"
              onClick={() => setBrowseOpen(false)}
              className="font-mono text-text-tertiary hover:text-text-secondary cursor-pointer"
              style={{ fontSize: '13px' }}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Input validation error */}
      {inputError && (
        <p className="font-mono text-dawn-coral" style={{ fontSize: '13px', marginTop: '-8px' }}>
          {inputError}
        </p>
      )}

      {/* Scope notes */}
      <div className="mb-4">
        <textarea
          value={scopeNotes}
          onChange={e => setScopeNotes(e.target.value)}
          placeholder="additional scope notes / context"
          rows={4}
          className="w-full font-mono text-text-primary bg-bg-elevated placeholder-text-tertiary resize-y"
          style={{
            fontSize: '14px',
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

      {/* Token budget */}
      <div className="mb-8">
        <label className="font-mono text-text-tertiary block mb-1" style={{ fontSize: '14px', letterSpacing: '0.04em' }}>
          token budget
        </label>
        <input
          type="text"
          value={tokenBudget.toLocaleString()}
          onChange={e => {
            const raw = e.target.value.replace(/[^0-9]/g, '');
            if (raw !== '') setTokenBudget(Number(raw));
          }}
          placeholder="1,000,000"
          className="w-full font-mono text-text-primary placeholder-text-tertiary"
          style={{
            fontSize: '14px',
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

      {/* Model selector */}
      <div className="mb-8">
        <label className="font-mono text-text-tertiary block mb-2" style={{ fontSize: '14px', letterSpacing: '0.04em' }}>
          model
        </label>
        <div className="flex gap-1">
          {['haiku', 'sonnet', 'opus'].map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setModel(m)}
              className={`font-mono cursor-pointer transition-colors duration-150 ${
                model === m
                  ? 'text-text-primary bg-bg-elevated-2/40'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
              style={{
                fontSize: '14px',
                letterSpacing: '0.04em',
                padding: '6px 14px',
                borderRadius: '999px',
                border: model === m
                  ? '0.5px solid var(--color-border-strong)'
                  : '0.5px solid var(--color-border-default)',
              }}
            >
              {m}
            </button>
          ))}
        </div>
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
