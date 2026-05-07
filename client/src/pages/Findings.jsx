import React, { useState, useEffect, useCallback } from 'react';
import FindingCard from '../components/FindingCard';
import SeverityBadge from '../components/SeverityBadge';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational'];
const STATUS_OPTIONS = ['pending', 'valid', 'invalid', 'not-important', 'out-of-scope'];

export default function Findings() {
  const [findings, setFindings] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ severity: '', agent: '', status: '' });
  const [doneTriage, setDoneTriage] = useState(false);

  const fetchFindings = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.agent) params.set('agent', filters.agent);
    if (filters.status) params.set('status', filters.status);

    fetch(`/api/findings?${params}`)
      .then(r => r.json())
      .then(data => {
        setFindings(data.findings || []);
        setTotal(data.total || 0);
      })
      .catch(() => {});
  }, [filters]);

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

  async function signalDoneTriage() {
    await fetch('/api/state/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'triage-complete', completedAt: new Date().toISOString() }),
    });
    setDoneTriage(true);
  }

  // Compute summary stats
  const stats = {};
  for (const sev of SEVERITY_ORDER) {
    stats[sev] = findings.filter(f => f.severity === sev).length;
  }

  const agents = [...new Set(findings.map(f => f.agent))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          Findings <span className="text-gray-500 text-lg">({total})</span>
        </h1>
        <button
          onClick={signalDoneTriage}
          disabled={doneTriage}
          className={`px-6 py-2 rounded font-semibold text-sm transition-colors ${
            doneTriage
              ? 'bg-gray-700 text-gray-500'
              : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          {doneTriage ? 'Triage Complete' : 'Done Triaging'}
        </button>
      </div>

      {/* Summary */}
      <div className="flex gap-3 flex-wrap">
        {SEVERITY_ORDER.map(sev => (
          stats[sev] > 0 && (
            <div key={sev} className="flex items-center gap-2">
              <SeverityBadge severity={sev} />
              <span className="text-sm font-medium">{stats[sev]}</span>
            </div>
          )
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={filters.severity}
          onChange={e => setFilters(prev => ({ ...prev, severity: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">All Severities</option>
          {SEVERITY_ORDER.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <select
          value={filters.agent}
          onChange={e => setFilters(prev => ({ ...prev, agent: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">All Agents</option>
          {agents.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Finding cards */}
      <div className="space-y-4">
        {findings.length === 0 ? (
          <p className="text-gray-500 text-center py-10">
            No findings yet. Waiting for audit to produce results...
          </p>
        ) : (
          findings.map(f => (
            <FindingCard
              key={f.id}
              finding={f}
              onUpdate={update => updateFinding(f.id, update)}
            />
          ))
        )}
      </div>
    </div>
  );
}
