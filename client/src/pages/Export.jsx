import { useState, useEffect } from 'react';
import SectionLabel from '../components/SectionLabel';
import SeverityBadge from '../components/SeverityBadge';
import ActionButton from '../components/ActionButton';
import MarkdownProse from '../components/MarkdownProse';
import { useToast } from '../components/Toast';
import { useRequireState } from '../hooks/useRouteGuard';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];

export default function Export() {
  const toast = useToast();
  const { loading: guardLoading } = useRequireState('findings', '/');
  const [findings, setFindings] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState('all');
  const [selectedSeverities, setSelectedSeverities] = useState(new Set(SEVERITIES));
  const [format, setFormat] = useState('markdown');
  const [includeThreatModel, setIncludeThreatModel] = useState(false);
  const [repo, setRepo] = useState('');
  const [report, setReport] = useState('');
  const [exportResult, setExportResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    fetch('/api/state/audit').then(r => r.json()).then(data => {
      if (data) setAudit(data);
    }).catch(err => toast('Failed to load audit state: ' + err.message, 'error'));
  }, []);

  useEffect(() => {
    fetch('/api/findings?status=valid')
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        const f = data.findings || [];
        setFindings(f);
        setSelected(new Set(f.map(x => x.id)));
      })
      .catch(err => toast('Failed to load findings: ' + err.message, 'error'));
  }, []);

  // Update selection based on mode
  useEffect(() => {
    if (selectionMode === 'all') {
      setSelected(new Set(findings.map(f => f.id)));
    } else if (selectionMode === 'by-severity') {
      setSelected(new Set(
        findings.filter(f => selectedSeverities.has(f.severity)).map(f => f.id)
      ));
    }
  }, [selectionMode, findings, selectedSeverities]);

  function toggleSelection(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeverity(sev) {
    setSelectedSeverities(prev => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }

  async function handleExport() {
    setRepoError('');

    if (format === 'github') {
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
        setRepoError('Repository must be in owner/repo format');
        return;
      }
    }

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
        toast('Export failed: ' + err.message, 'error');
      }
    } else if (format === 'json') {
      try {
        const res = await fetch('/api/export/json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ findingIds: ids }),
        });
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data.findings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-findings-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('JSON file downloaded', 'success');
      } catch (err) {
        toast('JSON export failed: ' + err.message, 'error');
      }
    } else if (format === 'print') {
      window.print();
    } else {
      // markdown
      try {
        const res = await fetch('/api/export/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ findingIds: ids, includeThreatModel }),
        });
        const data = await res.json();
        setReport(data.report || '');
      } catch (err) {
        toast('Report generation failed: ' + err.message, 'error');
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
        <SectionLabel>audit · {audit?.repoUrl?.split('/').pop()?.replace('.git', '') || audit?.localPath?.split('/').pop() || 'export'}</SectionLabel>
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
                  <span className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
                    {m === 'all' ? 'all valid' : m === 'manual' ? 'manual select' : 'by severity'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* By-severity checkboxes */}
          {selectionMode === 'by-severity' && (
            <div className="space-y-1">
              {SEVERITIES.map(sev => (
                <label key={sev} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSeverities.has(sev)}
                    onChange={() => toggleSeverity(sev)}
                    className="accent-[var(--color-dawn-amber)]"
                  />
                  <SeverityBadge severity={sev} />
                  <span className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
                    ({findings.filter(f => f.severity === sev).length})
                  </span>
                </label>
              ))}
            </div>
          )}

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
                    style={{ fontSize: '13px' }}
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
                { key: 'json', label: 'json export' },
                { key: 'print', label: 'print / pdf' },
              ].map(f => (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    checked={format === f.key}
                    onChange={() => setFormat(f.key)}
                    className="accent-[var(--color-dawn-amber)]"
                  />
                  <span className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
                    {f.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Threat model options */}
          <div>
            <SectionLabel>threat model</SectionLabel>
            <div className="mt-2 space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeThreatModel}
                  onChange={() => setIncludeThreatModel(!includeThreatModel)}
                  className="accent-[var(--color-dawn-amber)]"
                />
                <span className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
                  include in report
                </span>
              </label>
            </div>
            <ActionButton
              onClick={async () => {
                try {
                  const res = await fetch('/api/export/threat-model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                  });
                  const data = await res.json();
                  if (data.error) {
                    toast(data.error, 'error');
                    return;
                  }
                  if (data.report) {
                    const blob = new Blob([data.report], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `threat-model-${new Date().toISOString().split('T')[0]}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast('Threat model downloaded', 'success');
                  }
                } catch (err) {
                  toast('Failed to download threat model: ' + err.message, 'error');
                }
              }}
              style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
            >
              download threat model .md
            </ActionButton>
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
                  fontSize: '14px',
                  padding: '8px 0',
                  border: 'none',
                  borderBottom: '0.5px solid var(--color-border-default)',
                  outline: 'none',
                  background: 'transparent',
                }}
              />
              {repoError && (
                <p className="font-mono text-dawn-coral mt-1" style={{ fontSize: '13px' }}>
                  {repoError}
                </p>
              )}
            </div>
          )}

          {/* Export button */}
          <ActionButton
            variant="primary"
            onClick={handleExport}
            disabled={loading || selected.size === 0 || (format === 'github' && !repo)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {loading ? 'exporting...' : format === 'print' ? 'print / save pdf' : 'export →'}
          </ActionButton>

          {report && (
            <ActionButton onClick={downloadReport} style={{ width: '100%', justifyContent: 'center' }}>
              download .md
            </ActionButton>
          )}

          {/* GitHub export results */}
          {exportResult && (
            <div className="font-mono" style={{ fontSize: '13px' }}>
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
          className="bg-bg-elevated overflow-y-auto print-preview"
          style={{
            borderRadius: 'var(--radius-xl)',
            border: '0.5px solid var(--color-border-default)',
            padding: '20px 24px',
            maxHeight: 'calc(100vh - 200px)',
          }}
        >
          {report ? (
            <MarkdownProse
              text={report}
              className="text-text-secondary"
              style={{ fontSize: '15px', lineHeight: '1.65' }}
            />
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
      <p className="font-mono text-text-tertiary text-center py-10" style={{ fontSize: '13px' }}>
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
            <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>{f.id}</span>
          </div>
          <h3
            className="font-display text-text-primary"
            style={{ fontSize: '17px', fontWeight: 500, lineHeight: '1.35' }}
          >
            {f.title}
          </h3>
          <p
            className="font-sans text-text-secondary mt-1"
            style={{ fontSize: '17px', lineHeight: '1.65' }}
          >
            {f.description}
          </p>
        </div>
      ))}
    </div>
  );
}
