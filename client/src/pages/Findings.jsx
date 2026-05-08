import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import FindingCard from '../components/FindingCard';
import DetailPanel from '../components/DetailPanel';
import SectionLabel from '../components/SectionLabel';
import Pill from '../components/Pill';
import KbdHint from '../components/KbdHint';
import ActionButton from '../components/ActionButton';
import { useToast } from '../components/Toast';
import { useRequireState } from '../hooks/useRouteGuard';

const SEVERITY_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];
const SORT_OPTIONS = [
  { value: '', label: 'default' },
  { value: 'severity', label: 'severity' },
  { value: 'confidence', label: 'confidence' },
  { value: 'file', label: 'file' },
  { value: 'agent', label: 'agent' },
];

function bucketFindings(findings) {
  const pending = [];
  const valid = [];
  const dismissed = [];
  for (const f of findings) {
    if (f.status === 'valid') valid.push(f);
    else if (f.status === 'invalid' || f.status === 'not-important' || f.status === 'out-of-scope') dismissed.push(f);
    else pending.push(f);
  }
  return { pending, valid, dismissed };
}

export default function Findings({ onStatusChange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { loading: guardLoading } = useRequireState('progress', '/');
  const [findings, setFindings] = useState([]);
  const [total, setTotal] = useState(0);
  const [severityFilter, setSeverityFilter] = useState(searchParams.get('severity') || 'all');
  const [agentFilter, setAgentFilter] = useState(searchParams.get('agent') || 'all');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || '');
  const [selectedId, setSelectedId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    fetch('/api/state/audit').then(r => r.json()).then(data => {
      if (data) setAudit(data);
    }).catch(err => toast('Failed to load audit state', 'error'));
  }, []);

  // Sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (agentFilter !== 'all') params.set('agent', agentFilter);
    if (searchQuery) params.set('search', searchQuery);
    if (sortBy) params.set('sort', sortBy);
    setSearchParams(params, { replace: true });
  }, [severityFilter, agentFilter, searchQuery, sortBy]);

  const fetchFindings = useCallback(() => {
    const params = new URLSearchParams();
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (agentFilter !== 'all') params.set('agent', agentFilter);
    if (searchQuery) params.set('search', searchQuery);
    if (sortBy) params.set('sort', sortBy);

    fetch(`/api/findings?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        const f = data.findings || [];
        setFindings(f);
        setTotal(data.total || 0);
        // auto-select first pending if nothing selected
        if (!selectedIdRef.current && f.length > 0) {
          const firstPending = f.find(x => x.status === 'pending');
          if (firstPending) setSelectedId(firstPending.id);
          else setSelectedId(f[0].id);
        }
      })
      .catch(err => toast('Failed to load findings: ' + err.message, 'error'));
  }, [severityFilter, agentFilter, searchQuery, sortBy]);

  useEffect(() => {
    fetchFindings();
    const poll = setInterval(fetchFindings, 3000);
    return () => clearInterval(poll);
  }, [fetchFindings]);

  async function updateFinding(id, update) {
    try {
      const res = await fetch(`/api/findings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Failed to update finding', 'error');
      }
    } catch (err) {
      toast('Failed to update finding: ' + err.message, 'error');
    }
    fetchFindings();
  }

  async function handleBulkTriage(status) {
    if (bulkSelected.size === 0) return;
    try {
      const res = await fetch('/api/findings/bulk-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(bulkSelected),
          status,
          triageReason: status === 'valid' ? undefined : status.replace('-', ' '),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Bulk triage failed', 'error');
      } else {
        const data = await res.json();
        toast(`Updated ${data.updated} findings`, 'success');
        setBulkSelected(new Set());
      }
    } catch (err) {
      toast('Bulk triage failed: ' + err.message, 'error');
    }
    fetchFindings();
  }

  function toggleBulkSelect(id) {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // keyboard navigation
  useEffect(() => {
    function handleKey(e) {
      // Don't intercept keystrokes in form elements
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
        return;
      }

      if (e.key === '/' ) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (e.key === 'b') {
        e.preventDefault();
        setBulkMode(prev => !prev);
        return;
      }

      const allIds = findings.map(f => f.id);
      const idx = allIds.indexOf(selectedId);
      if (e.key === 'j' && idx < allIds.length - 1) {
        e.preventDefault();
        setSelectedId(allIds[idx + 1]);
      } else if (e.key === 'k' && idx > 0) {
        e.preventDefault();
        setSelectedId(allIds[idx - 1]);
      } else if (e.key === 'v' && selectedId) {
        e.preventDefault();
        updateFinding(selectedId, { status: 'valid' });
      } else if (e.key === 'i' && selectedId) {
        e.preventDefault();
        updateFinding(selectedId, { status: 'invalid', triageReason: 'invalid' });
      } else if (e.key === 'n' && selectedId) {
        e.preventDefault();
        updateFinding(selectedId, { status: 'not-important', triageReason: 'not important' });
      } else if (e.key === 'o' && selectedId) {
        e.preventDefault();
        updateFinding(selectedId, { status: 'out-of-scope', triageReason: 'out of scope' });
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [findings, selectedId]);

  const { pending, valid, dismissed } = bucketFindings(findings);
  const selectedFinding = findings.find(f => f.id === selectedId);

  // severity counts for pills
  const sevCounts = {};
  for (const f of findings) {
    const s = f.severity?.toLowerCase() || 'info';
    sevCounts[s] = (sevCounts[s] || 0) + 1;
  }

  // unique agents
  const agents = [...new Set(findings.map(f => f.agent).filter(Boolean))];

  const pendingCount = pending.length;
  const verdictCount = valid.length + dismissed.length;

  function handleDrop(column, e) {
    e.preventDefault();
    setDragOverColumn(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;

    if (column === 'valid') {
      updateFinding(id, { status: 'valid' });
    } else if (column === 'dismissed') {
      const existing = findings.find(f => f.id === id);
      const alreadyDismissed = existing && ['invalid', 'not-important', 'out-of-scope'].includes(existing.status);
      updateFinding(id, {
        status: alreadyDismissed ? existing.status : 'invalid',
        triageReason: alreadyDismissed ? existing.triageReason : 'invalid',
      });
    } else {
      updateFinding(id, { status: 'pending' });
    }
  }

  return (
    <div ref={containerRef}>
      {/* Page header */}
      <div className="mb-4">
        <SectionLabel>audit · {audit?.repoUrl?.split('/').pop()?.replace('.git', '') || audit?.localPath?.split('/').pop() || 'triage'}</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
        >
          findings
        </h1>
        <p className="font-mono text-text-tertiary mt-1" style={{ fontSize: '13px' }}>
          {total} surfaced · {pendingCount} pending · {verdictCount} verdicts in
        </p>
      </div>

      {/* Search + filter row */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="search findings..."
          className="font-mono text-text-primary placeholder-text-tertiary"
          style={{
            fontSize: '13px',
            padding: '6px 10px',
            border: '0.5px solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            background: 'transparent',
            width: '200px',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--color-border-strong)'}
          onBlur={e => e.target.style.borderColor = ''}
        />

        {SEVERITY_FILTERS.map(sev => (
          <Pill
            key={sev}
            active={severityFilter === sev}
            onClick={() => setSeverityFilter(sev)}
            severity={sev !== 'all' ? sev : undefined}
            count={sev === 'all' ? total : sevCounts[sev] || 0}
          >
            {sev}
          </Pill>
        ))}

        <select
          value={agentFilter}
          onChange={e => setAgentFilter(e.target.value)}
          className="font-mono text-text-secondary cursor-pointer"
          style={{
            fontSize: '13px',
            padding: '5px 8px',
            border: '0.5px solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            outline: 'none',
            marginLeft: 'auto',
          }}
        >
          <option value="all">all agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="font-mono text-text-secondary cursor-pointer"
          style={{
            fontSize: '13px',
            padding: '5px 8px',
            border: '0.5px solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            outline: 'none',
          }}
        >
          {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Bulk mode toggle */}
      <div className="flex items-center gap-3 mb-4">
        <Pill active={bulkMode} onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}>
          {bulkMode ? `bulk (${bulkSelected.size})` : 'bulk'}
        </Pill>

        {bulkMode && bulkSelected.size > 0 && (
          <div
            className="flex items-center gap-2"
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-elevated)',
              border: '0.5px solid var(--color-border-default)',
            }}
          >
            <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
              {bulkSelected.size} selected:
            </span>
            <ActionButton onClick={() => handleBulkTriage('valid')}>valid</ActionButton>
            <ActionButton onClick={() => handleBulkTriage('invalid')}>invalid</ActionButton>
            <ActionButton onClick={() => handleBulkTriage('not-important')}>not important</ActionButton>
            <ActionButton onClick={() => handleBulkTriage('out-of-scope')}>out of scope</ActionButton>
          </div>
        )}
      </div>

      {/* Main layout: kanban left, detail right */}
      <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 320px)' }}>
        {/* Kanban columns */}
        <div className="grid grid-cols-3 gap-2.5" style={{ flex: '0 0 55%', alignContent: 'start' }}>
          {[
            { key: 'pending', label: 'pending', items: pending },
            { key: 'valid', label: 'valid', items: valid },
            { key: 'dismissed', label: 'dismissed', items: dismissed },
          ].map(col => (
            <div
              key={col.key}
              onDragOver={e => { e.preventDefault(); setDragOverColumn(col.key); }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={e => handleDrop(col.key, e)}
              style={{
                borderRadius: 'var(--radius-lg)',
                border: dragOverColumn === col.key
                  ? '0.5px solid var(--color-border-strong)'
                  : '0.5px solid transparent',
                padding: '8px',
                transition: 'border-color 150ms',
              }}
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <SectionLabel>{col.label}</SectionLabel>
                <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
                  {col.items.length}
                </span>
              </div>
              <div>
                {col.items.map(f => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    selected={f.id === selectedId}
                    muted={col.key === 'dismissed'}
                    onClick={() => bulkMode ? toggleBulkSelect(f.id) : setSelectedId(f.id)}
                    checkbox={bulkMode}
                    checked={bulkSelected.has(f.id)}
                  />
                ))}
                {col.items.length === 0 && (
                  <p className="text-text-tertiary font-mono text-center py-6" style={{ fontSize: '13px' }}>
                    {col.key === 'pending' ? 'no pending findings' : `no ${col.label} findings`}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel — right side, sticky */}
        <div style={{ flex: '1 1 45%', position: 'sticky', top: '72px', alignSelf: 'start', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
          {selectedFinding ? (
            <DetailPanel
              finding={selectedFinding}
              onVerdict={update => updateFinding(selectedFinding.id, update)}
            />
          ) : (
            <div
              className="flex items-center justify-center bg-bg-elevated"
              style={{
                borderRadius: 'var(--radius-xl)',
                border: '0.5px solid var(--color-border-subtle)',
                padding: '40px 20px',
              }}
            >
              <p className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
                select a finding to view details
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard hints footer */}
      <div
        className="flex items-center gap-4 mt-6 pt-4"
        style={{ borderTop: '0.5px solid var(--color-border-subtle)' }}
      >
        <KbdHint shortcut="v" label="valid" />
        <KbdHint shortcut="i" label="invalid" />
        <KbdHint shortcut="n" label="not important" />
        <KbdHint shortcut="o" label="out of scope" />
        <KbdHint shortcut="j/k" label="navigate" />
        <KbdHint shortcut="/" label="search" />
        <KbdHint shortcut="b" label="bulk mode" />
      </div>
    </div>
  );
}
