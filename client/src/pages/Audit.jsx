import React, { useState, useEffect } from 'react';
import ProgressBar from '../components/ProgressBar';

const PHASES = ['prescan', 'agents', 'dedup', 'done'];
const PHASE_LABELS = {
  prescan: 'Static Analysis',
  agents: 'Agent Analysis',
  dedup: 'Deduplication',
  done: 'Complete',
};

export default function Audit() {
  const [progress, setProgress] = useState(null);
  const [leads, setLeads] = useState(null);

  useEffect(() => {
    const poll = setInterval(() => {
      fetch('/api/state/progress').then(r => r.json()).then(setProgress).catch(() => {});
      fetch('/api/state/leads').then(r => r.json()).then(setLeads).catch(() => {});
    }, 2000);

    fetch('/api/state/progress').then(r => r.json()).then(setProgress).catch(() => {});
    fetch('/api/state/leads').then(r => r.json()).then(setLeads).catch(() => {});

    return () => clearInterval(poll);
  }, []);

  const currentPhase = progress?.phase || 'prescan';
  const phaseIdx = PHASES.indexOf(currentPhase);
  const agents = progress?.agents || {};

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Progress</h1>

      {/* Phase progress bar */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        <div className="flex justify-between mb-4">
          {PHASES.map((phase, i) => (
            <div
              key={phase}
              className={`flex items-center gap-2 text-sm font-medium ${
                i < phaseIdx
                  ? 'text-emerald-400'
                  : i === phaseIdx
                  ? 'text-white'
                  : 'text-gray-500'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  i < phaseIdx
                    ? 'bg-emerald-500 text-white'
                    : i === phaseIdx
                    ? 'bg-emerald-500/30 text-emerald-400 border border-emerald-500'
                    : 'bg-gray-700 text-gray-500'
                }`}
              >
                {i < phaseIdx ? '✓' : i + 1}
              </div>
              {PHASE_LABELS[phase]}
            </div>
          ))}
        </div>
        <ProgressBar value={((phaseIdx + 1) / PHASES.length) * 100} />
      </div>

      {/* Static analysis leads */}
      {leads && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-2">Static Analysis Leads</h2>
          <div className="text-3xl font-bold text-emerald-400">
            {(leads.leads || []).length}
          </div>
          <p className="text-sm text-gray-400 mt-1">patterns detected by automated scanners</p>
        </div>
      )}

      {/* Agent status cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Object.entries(agents).map(([name, info]) => (
          <div
            key={name}
            className="bg-gray-800/50 border border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm truncate">{formatAgentName(name)}</h3>
              <StatusBadge status={info.status} />
            </div>
            {info.status === 'running' && (
              <div className="mt-2">
                <ProgressBar value={info.progress || 0} size="sm" />
              </div>
            )}
            {info.findingCount !== undefined && (
              <p className="text-xs text-gray-400 mt-2">
                {info.findingCount} finding{info.findingCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        ))}
      </div>

      {currentPhase === 'done' && (
        <div className="bg-emerald-500/10 border border-emerald-500/50 rounded-lg p-6 text-center">
          <h2 className="text-xl font-bold text-emerald-400">Audit Complete</h2>
          <p className="text-gray-400 mt-2">
            Review findings in the Findings tab.
          </p>
        </div>
      )}
    </div>
  );
}

function formatAgentName(name) {
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-gray-700 text-gray-400',
    running: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-emerald-500/20 text-emerald-400',
    error: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.pending}`}>
      {status || 'pending'}
    </span>
  );
}
