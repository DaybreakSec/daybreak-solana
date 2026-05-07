import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Start Audit</h1>

      {warnings.length > 0 && (
        <div className="border border-red-500/50 bg-red-500/10 rounded-lg p-4">
          <h3 className="text-red-400 font-semibold mb-2">
            Prompt Injection Warnings
          </h3>
          {warnings.map((w, i) => (
            <div key={i} className="text-sm text-red-300 mb-1">
              <span className="font-mono">{w.file}:{w.line}</span> — {w.pattern}
              <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                w.risk === 'high' ? 'bg-red-500/30' : 'bg-yellow-500/30'
              }`}>
                {w.risk}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-4">
          <button
            onClick={() => setMode('git')}
            className={`px-4 py-2 rounded font-medium text-sm ${
              mode === 'git'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}
          >
            Git Repository
          </button>
          <button
            onClick={() => setMode('local')}
            className={`px-4 py-2 rounded font-medium text-sm ${
              mode === 'local'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}
          >
            Local Directory
          </button>
        </div>

        {mode === 'git' ? (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Repository URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/program.git"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Local Path</label>
            <input
              type="text"
              value={localPath}
              onChange={e => setLocalPath(e.target.value)}
              placeholder="/home/user/projects/my-program"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Scope Notes (optional)
          </label>
          <textarea
            value={scopeNotes}
            onChange={e => setScopeNotes(e.target.value)}
            placeholder="Additional context about the program, specific areas of concern, or scope restrictions..."
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-y"
          />
        </div>

        <button
          onClick={handleStart}
          disabled={loading || (!repoUrl && !localPath)}
          className="w-full py-3 rounded font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
        >
          {loading ? 'Starting...' : 'Start Audit'}
        </button>
      </div>
    </div>
  );
}
