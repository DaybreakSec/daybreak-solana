import React, { useState } from 'react';
import SeverityBadge from './SeverityBadge';
import CodeBlock from './CodeBlock';

const STATUS_ACTIONS = [
  { value: 'valid', label: 'Valid', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { value: 'invalid', label: 'Invalid', color: 'bg-red-600 hover:bg-red-500' },
  { value: 'not-important', label: 'Not Important', color: 'bg-gray-600 hover:bg-gray-500' },
  { value: 'out-of-scope', label: 'Out of Scope', color: 'bg-gray-600 hover:bg-gray-500' },
];

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];

export default function FindingCard({ finding, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(finding.notes || '');

  return (
    <div className={`border rounded-lg overflow-hidden ${statusBorder(finding.status)}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-gray-800/50 hover:bg-gray-800"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-gray-500 text-xs font-mono">{finding.id}</span>
        <SeverityBadge severity={finding.severity} />
        <span className="font-medium text-sm flex-1 truncate">{finding.title}</span>
        <span className="text-xs text-gray-500">{finding.agent}</span>
        <StatusPill status={finding.status} />
        <span className="text-gray-500 text-sm">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 py-4 space-y-4 border-t border-gray-800">
          {/* File reference */}
          <div className="text-sm">
            <span className="text-gray-400">Location: </span>
            <span className="font-mono text-emerald-400">{finding.file}:{finding.line}</span>
          </div>

          {/* Bug class */}
          <div className="text-sm">
            <span className="text-gray-400">Bug Class: </span>
            <span className="font-mono">{finding.bugClass}</span>
          </div>

          {/* Description */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-1">Description</h4>
            <p className="text-sm text-gray-300 leading-relaxed">{finding.description}</p>
          </div>

          {/* Proof */}
          {finding.proof && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-1">Proof</h4>
              <CodeBlock code={finding.proof} file={finding.file} line={finding.line} />
            </div>
          )}

          {/* Recommendation */}
          {finding.recommendation && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-1">Recommendation</h4>
              <p className="text-sm text-gray-300 leading-relaxed">{finding.recommendation}</p>
            </div>
          )}

          {/* Triage actions */}
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {STATUS_ACTIONS.map(action => (
                <button
                  key={action.value}
                  onClick={() => onUpdate({ status: action.value })}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    finding.status === action.value
                      ? action.color + ' ring-2 ring-offset-1 ring-offset-gray-900'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Severity override */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Change severity:</span>
              {SEVERITIES.map(sev => (
                <button
                  key={sev}
                  onClick={() => onUpdate({ severity: sev })}
                  className={`text-xs px-2 py-0.5 rounded capitalize ${
                    finding.severity === sev
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Notes */}
            <div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => onUpdate({ notes })}
                placeholder="Add triage notes..."
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-y"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const styles = {
    pending: 'bg-gray-700 text-gray-400',
    valid: 'bg-emerald-500/20 text-emerald-400',
    invalid: 'bg-red-500/20 text-red-400',
    'not-important': 'bg-gray-600/50 text-gray-400',
    'out-of-scope': 'bg-gray-600/50 text-gray-400',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.pending}`}>
      {status || 'pending'}
    </span>
  );
}

function statusBorder(status) {
  const borders = {
    valid: 'border-emerald-500/40',
    invalid: 'border-red-500/30',
    pending: 'border-gray-700',
  };
  return borders[status] || borders.pending;
}
