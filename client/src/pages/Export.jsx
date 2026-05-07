import { useState, useEffect } from 'react';
import SectionLabel from '../components/SectionLabel';
import SeverityBadge from '../components/SeverityBadge';
import ActionButton from '../components/ActionButton';
import CodeBlock from '../components/CodeBlock';

export default function Export() {
  const [findings, setFindings] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState('all');
  const [format, setFormat] = useState('markdown');
  const [repo, setRepo] = useState('');
  const [report, setReport] = useState('');
  const [exportResult, setExportResult] = useState(null);
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

  // update selection based on mode
  useEffect(() => {
    if (selectionMode === 'all') {
      setSelected(new Set(findings.map(f => f.id)));
    }
  }, [selectionMode, findings]);

  function toggleSelection(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    setLoading(true);
    setExportResult(null);
    setReport('');

    const ids = Array.from(selected);

    if (format === 'github') {
      try {
        const res = await fetch('/api/export/github-issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, findingIds: ids }),
        });
        setExportResult(await res.json());
      } catch (err) {
        setExportResult({ error: err.message });
      }
    } else {
      try {
        const res = await fetch('/api/export/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ findingIds: ids }),
        });
        const data = await res.json();
        setReport(data.report || '');
      } catch (err) {
        setReport(`error: ${err.message}`);
      }
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

  const selectedFindings = findings.filter(f => selected.has(f.id));

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <SectionLabel>audit 003 · export</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
        >
          export findings
        </h1>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6" style={{ gridTemplateColumns: '280px 1fr' }}>
        {/* Controls column */}
        <div className="space-y-5">
          {/* Selection mode */}
          <div>
            <SectionLabel>selection</SectionLabel>
            <div className="mt-2 space-y-1">
              {['all', 'manual', 'by-severity'].map(m => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="selectionMode"
                    checked={selectionMode === m}
                    onChange={() => setSelectionMode(m)}
                    className="accent-[var(--color-dawn-amber)]"
                  />
                  <span className="font-mono text-text-secondary" style={{ fontSize: '11px' }}>
                    {m === 'all' ? 'all valid' : m === 'manual' ? 'manual select' : 'by severity'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Manual selection list */}
          {selectionMode === 'manual' && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {findings.map(f => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(f.id)}
                    onChange={() => toggleSelection(f.id)}
                    className="accent-[var(--color-dawn-amber)]"
                  />
                  <SeverityBadge severity={f.severity} />
                  <span
                    className="font-mono text-text-secondary truncate"
                    style={{ fontSize: '11px' }}
                  >
                    {f.title}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Format selection */}
          <div>
            <SectionLabel>format</SectionLabel>
            <div className="mt-2 space-y-1">
              {[
                { key: 'github', label: 'github issues' },
                { key: 'markdown', label: 'markdown report' },
                { key: 'pdf', label: 'pdf report' },
              ].map(f => (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    checked={format === f.key}
                    onChange={() => setFormat(f.key)}
                    className="accent-[var(--color-dawn-amber)]"
                  />
                  <span className="font-mono text-text-secondary" style={{ fontSize: '11px' }}>
                    {f.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* GitHub repo input */}
          {format === 'github' && (
            <div>
              <SectionLabel>repository</SectionLabel>
              <input
                type="text"
                value={repo}
                onChange={e => setRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full font-mono text-text-primary mt-2"
                style={{
                  fontSize: '12px',
                  padding: '8px 0',
                  border: 'none',
                  borderBottom: '0.5px solid var(--color-border-default)',
                  outline: 'none',
                  background: 'transparent',
                }}
              />
            </div>
          )}

          {/* Export button */}
          <ActionButton
            variant="primary"
            onClick={handleExport}
            disabled={loading || selected.size === 0 || (format === 'github' && !repo)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {loading ? 'exporting...' : 'export →'}
          </ActionButton>

          {report && (
            <ActionButton onClick={downloadReport} style={{ width: '100%', justifyContent: 'center' }}>
              download .md
            </ActionButton>
          )}

          {/* GitHub export results */}
          {exportResult && (
            <div className="font-mono" style={{ fontSize: '11px' }}>
              {exportResult.error ? (
                <p className="text-dawn-coral">{exportResult.error}</p>
              ) : (
                (exportResult.created || []).map((c, i) => (
                  <p key={i} className={c.error ? 'text-dawn-coral' : 'text-dawn-gold'}>
                    {c.findingId}: {c.issueUrl || c.error}
                  </p>
                ))
              )}
            </div>
          )}
        </div>

        {/* Preview column */}
        <div
          className="bg-bg-elevated overflow-y-auto"
          style={{
            borderRadius: 'var(--radius-xl)',
            border: '0.5px solid var(--color-border-default)',
            padding: '20px 24px',
            maxHeight: 'calc(100vh - 200px)',
          }}
        >
          {report ? (
            <ReportPreview report={report} />
          ) : (
            <PreviewFindings findings={selectedFindings} />
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewFindings({ findings }) {
  if (findings.length === 0) {
    return (
      <p className="font-mono text-text-tertiary text-center py-10" style={{ fontSize: '11px' }}>
        select findings to preview export
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-4">
        <SectionLabel>preview · {findings.length} findings</SectionLabel>
      </div>
      {findings.map(f => (
        <div key={f.id} className="pb-4" style={{ borderBottom: '0.5px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge severity={f.severity} />
            <span className="font-mono text-text-tertiary" style={{ fontSize: '11px' }}>{f.id}</span>
          </div>
          <h3
            className="font-display text-text-primary"
            style={{ fontSize: '15px', fontWeight: 500, lineHeight: '1.35' }}
          >
            {f.title}
          </h3>
          <p
            className="font-sans text-text-secondary mt-1"
            style={{ fontSize: '13.5px', lineHeight: '1.65' }}
          >
            {f.description}
          </p>
        </div>
      ))}
    </div>
  );
}

function ReportPreview({ report }) {
  // render markdown-ish preview with daybreak styling
  const lines = report.split('\n');

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) {
          return (
            <h1 key={i} className="font-display text-text-primary" style={{ fontSize: '22px', fontWeight: 500, lineHeight: '1.2' }}>
              {line.slice(2)}
            </h1>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h2 key={i} className="font-display text-text-primary mt-4" style={{ fontSize: '19px', fontWeight: 500, lineHeight: '1.25' }}>
              {line.slice(3)}
            </h2>
          );
        }
        if (line.startsWith('### ')) {
          return (
            <h3 key={i} className="font-display text-text-primary mt-3" style={{ fontSize: '15px', fontWeight: 500, lineHeight: '1.35' }}>
              {line.slice(4)}
            </h3>
          );
        }
        if (line.startsWith('```')) {
          return null; // code fence markers
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <p key={i} className="font-sans text-text-secondary pl-4" style={{ fontSize: '13.5px', lineHeight: '1.65' }}>
              • {line.slice(2)}
            </p>
          );
        }
        if (line.startsWith('|')) {
          return (
            <p key={i} className="font-mono text-text-secondary" style={{ fontSize: '11px' }}>
              {line}
            </p>
          );
        }
        if (line.trim() === '') {
          return <div key={i} className="h-2" />;
        }
        return (
          <p key={i} className="font-sans text-text-secondary" style={{ fontSize: '13.5px', lineHeight: '1.65' }}>
            {line}
          </p>
        );
      })}
    </div>
  );
}
