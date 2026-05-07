import React, { useState, useEffect } from 'react';

export default function Export() {
  const [findings, setFindings] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [repo, setRepo] = useState('');
  const [exportResult, setExportResult] = useState(null);
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/findings?status=valid')
      .then(r => r.json())
      .then(data => {
        const f = data.findings || [];
        setFindings(f);
        setSelected(new Set(f.map(x => x.id)));
      })
      .catch(() => {});
  }, []);

  function toggleSelection(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportGitHub() {
    if (!repo) return;
    setLoading(true);
    setExportResult(null);
    try {
      const res = await fetch('/api/export/github-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo,
          findingIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      setExportResult(data);
    } catch (err) {
      setExportResult({ error: err.message });
    }
    setLoading(false);
  }

  async function generateReport() {
    setLoading(true);
    setReport('');
    try {
      const res = await fetch('/api/export/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingIds: Array.from(selected) }),
      });
      const data = await res.json();
      setReport(data.report || '');
    } catch (err) {
      setReport(`Error: ${err.message}`);
    }
    setLoading(false);
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-report-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Export</h1>

      {/* Finding selection */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <h2 className="font-semibold mb-3">
          Select Findings ({selected.size} / {findings.length})
        </h2>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {findings.length === 0 ? (
            <p className="text-gray-500 text-sm">No valid findings to export.</p>
          ) : (
            findings.map(f => (
              <label key={f.id} className="flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggleSelection(f.id)}
                  className="accent-emerald-500"
                />
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${severityColor(f.severity)}`}>
                  {f.severity}
                </span>
                <span className="truncate">{f.title}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Export options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* GitHub Issues */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">GitHub Issues</h2>
          <p className="text-sm text-gray-400">
            Create issues in a GitHub repository. Requires gh CLI authentication.
          </p>
          <input
            type="text"
            value={repo}
            onChange={e => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
          />
          <button
            onClick={exportGitHub}
            disabled={loading || !repo || selected.size === 0}
            className="w-full py-2 rounded font-medium text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating Issues...' : 'Create GitHub Issues'}
          </button>
          {exportResult && (
            <div className="text-xs mt-2">
              {exportResult.error ? (
                <p className="text-red-400">{exportResult.error}</p>
              ) : (
                (exportResult.created || []).map((c, i) => (
                  <p key={i} className={c.error ? 'text-red-400' : 'text-emerald-400'}>
                    {c.findingId}: {c.issueUrl || c.error}
                  </p>
                ))
              )}
            </div>
          )}
        </div>

        {/* Markdown Report */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Markdown Report</h2>
          <p className="text-sm text-gray-400">
            Generate a formatted audit report.
          </p>
          <button
            onClick={generateReport}
            disabled={loading || selected.size === 0}
            className="w-full py-2 rounded font-medium text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          {report && (
            <button
              onClick={downloadReport}
              className="w-full py-2 rounded font-medium text-sm bg-emerald-600 hover:bg-emerald-500 transition-colors"
            >
              Download Report
            </button>
          )}
        </div>
      </div>

      {/* Report preview */}
      {report && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Report Preview</h2>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto font-mono">
            {report}
          </pre>
        </div>
      )}
    </div>
  );
}

function severityColor(s) {
  const colors = {
    critical: 'bg-red-500/20 text-red-400',
    high: 'bg-orange-500/20 text-orange-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    low: 'bg-blue-500/20 text-blue-400',
    informational: 'bg-gray-500/20 text-gray-400',
  };
  return colors[s] || colors.informational;
}
