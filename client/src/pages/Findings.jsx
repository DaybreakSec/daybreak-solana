import { useState, useEffect, useCallback, useRef } from 'react';
import FindingCard from '../components/FindingCard';
import DetailPanel from '../components/DetailPanel';
import SectionLabel from '../components/SectionLabel';
import Pill from '../components/Pill';
import KbdHint from '../components/KbdHint';

const SEVERITY_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];

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
  const [findings, setFindings] = useState([]);
  const [total, setTotal] = useState(0);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const containerRef = useRef(null);

  const fetchFindings = useCallback(() => {
    const params = new URLSearchParams();
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (agentFilter !== 'all') params.set('agent', agentFilter);

    fetch(`/api/findings?${params}`)
      .then(r => r.json())
      .then(data => {
        const f = data.findings || [];
        setFindings(f);
        setTotal(data.total || 0);
        // auto-select first pending if nothing selected
        if (!selectedId && f.length > 0) {
          const firstPending = f.find(x => x.status === 'pending');
          if (firstPending) setSelectedId(firstPending.id);
          else setSelectedId(f[0].id);
        }
      })
      .catch(() => {});
  }, [severityFilter, agentFilter, selectedId]);

  useEffect(() => {
    fetchFindings();
    const poll = setInterval(fetchFindings, 3000);
    return () => clearInterval(poll);
  }, [fetchFindings]);

  async function updateFinding(id, update) {
    await fetch(`/api/findings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    fetchFindings();
  }

  // keyboard navigation
  useEffect(() => {
    function handleKey(e) {
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
    const statusMap = {
      pending: 'pending',
      valid: 'valid',
      dismissed: 'out-of-scope',
    };
    updateFinding(id, { status: statusMap[column] || 'pending' });
  }

  return (
    <div ref={containerRef}>
      {/* Page header */}
      <div className="mb-4">
        <SectionLabel>audit 003 · triage</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
        >
          findings
        </h1>
        <p className="font-mono text-text-tertiary mt-1" style={{ fontSize: '11px' }}>
          {total} surfaced · {pendingCount} pending · {verdictCount} verdicts in
        </p>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
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
        <div className="ml-auto">
          <Pill
            active={agentFilter !== 'all'}
            onClick={() => {
              // cycle through agents or reset
              const currentIdx = agents.indexOf(agentFilter);
              if (currentIdx < agents.length - 1) setAgentFilter(agents[currentIdx + 1]);
              else setAgentFilter('all');
            }}
          >
            {agentFilter === 'all' ? 'all agents' : agentFilter}
          </Pill>
        </div>
      </div>

      {/* Three columns */}
      <div className="grid grid-cols-3 gap-2.5">
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
              <span className="font-mono text-text-tertiary" style={{ fontSize: '11px' }}>
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
                  onClick={() => setSelectedId(f.id)}
                />
              ))}
              {col.items.length === 0 && (
                <p className="text-text-tertiary font-mono text-center py-6" style={{ fontSize: '11px' }}>
                  {col.key === 'pending' ? 'no pending findings' : `no ${col.label} findings`}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selectedFinding && (
        <DetailPanel
          finding={selectedFinding}
          onVerdict={update => updateFinding(selectedFinding.id, update)}
        />
      )}

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
      </div>
    </div>
  );
}
