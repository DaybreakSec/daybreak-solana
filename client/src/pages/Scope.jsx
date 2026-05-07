import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Scope() {
  const navigate = useNavigate();
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState(new Set());

  useEffect(() => {
    const poll = setInterval(() => {
      fetch('/api/state/scope')
        .then(r => r.json())
        .then(data => {
          if (data) {
            setScope(data);
            setLoading(false);
          }
        })
        .catch(() => {});
    }, 2000);

    // Initial fetch
    fetch('/api/state/scope')
      .then(r => r.json())
      .then(data => {
        if (data) {
          setScope(data);
          setLoading(false);
          if (data.excludedFiles) {
            setExcluded(new Set(data.excludedFiles));
          }
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
        <div className="inline-block w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-gray-400">Waiting for scope analysis...</p>
      </div>
    );
  }

  if (!scope) {
    return <p className="text-gray-400">No scope data available. Start an audit first.</p>;
  }

  const inScopeFiles = (scope.files || []).filter(f => !excluded.has(f.path));
  const inScopeLoc = inScopeFiles.reduce((sum, f) => sum + f.loc, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scope Review</h1>
        <button
          onClick={acceptScope}
          className="px-6 py-2 rounded font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 transition-colors"
        >
          Accept Scope
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-400">Framework</div>
          <div className="text-xl font-semibold text-emerald-400 capitalize">
            {scope.framework || 'Unknown'}
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-400">In-Scope LOC</div>
          <div className="text-xl font-semibold">{inScopeLoc.toLocaleString()}</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-400">Files</div>
          <div className="text-xl font-semibold">
            {inScopeFiles.length} / {(scope.files || []).length}
          </div>
        </div>
      </div>

      <div className="border border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-800">
            <tr>
              <th className="text-left px-4 py-2 text-gray-400 font-medium w-8">
                <input
                  type="checkbox"
                  checked={excluded.size === 0}
                  onChange={() => {
                    if (excluded.size === 0) {
                      setExcluded(new Set((scope.files || []).map(f => f.path)));
                    } else {
                      setExcluded(new Set());
                    }
                  }}
                  className="accent-emerald-500"
                />
              </th>
              <th className="text-left px-4 py-2 text-gray-400 font-medium">File</th>
              <th className="text-right px-4 py-2 text-gray-400 font-medium">LOC</th>
              <th className="text-right px-4 py-2 text-gray-400 font-medium">Language</th>
            </tr>
          </thead>
          <tbody>
            {(scope.files || []).map(f => (
              <tr
                key={f.path}
                className={`border-t border-gray-800 ${
                  excluded.has(f.path) ? 'opacity-40' : ''
                }`}
              >
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={!excluded.has(f.path)}
                    onChange={() => toggleFile(f.path)}
                    className="accent-emerald-500"
                  />
                </td>
                <td className="px-4 py-2 font-mono text-xs">{f.path}</td>
                <td className="px-4 py-2 text-right">{f.loc}</td>
                <td className="px-4 py-2 text-right text-gray-400">{f.language}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
