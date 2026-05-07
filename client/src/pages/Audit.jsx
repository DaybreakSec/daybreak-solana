import { useState, useEffect, useRef } from 'react';
import AgentCard from '../components/AgentCard';
import HorizonMeter from '../components/HorizonMeter';
import SectionLabel from '../components/SectionLabel';

const AGENT_ORDER = [
  'accounts-access',
  'cpi-token',
  'arithmetic-economic',
  'state-lifecycle',
  'invariant-logic',
];

const AGENT_DISPLAY = {
  'accounts-access': 'accounts & access control',
  'cpi-token': 'cpi & token operations',
  'arithmetic-economic': 'arithmetic & economic',
  'state-lifecycle': 'state lifecycle',
  'invariant-logic': 'invariant & logic',
};

export default function Audit({ onStatusChange }) {
  const [progress, setProgress] = useState(null);
  const [findings, setFindings] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const completionFired = useRef(false);

  useEffect(() => {
    let active = true;
    function poll() {
      fetch('/api/state/progress').then(r => r.json()).then(data => {
        if (active) setProgress(data);
      }).catch(() => {});
      fetch('/api/findings').then(r => r.json()).then(data => {
        if (active) setFindings(data.findings || []);
      }).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Completion transition (5.2)
  useEffect(() => {
    if (!progress || completionFired.current) return;
    const allDone = progress.phase === 'done';
    if (!allDone) return;

    // check if all critical findings are triaged
    const criticalPending = findings.filter(
      f => f.severity === 'critical' && f.status === 'pending'
    );
    if (criticalPending.length > 0) return;

    completionFired.current = true;
    onStatusChange?.('complete');

    // background warm shift
    document.documentElement.style.setProperty('--color-bg-base', '#1A1F38');
    document.documentElement.style.transition = 'background 3s linear';

    // sweeping gold line
    const line = document.createElement('div');
    line.style.cssText = `
      position: fixed; bottom: 0; left: 0; width: 100%; height: 1px;
      background: var(--color-dawn-gold);
      transform: translateX(-100%);
      transition: transform 3s linear;
      z-index: 9999;
      pointer-events: none;
    `;
    document.body.appendChild(line);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        line.style.transform = 'translateX(0)';
      });
    });
    setTimeout(() => {
      line.remove();
      document.documentElement.style.removeProperty('--color-bg-base');
      document.documentElement.style.transition = '';
    }, 3500);
  }, [progress, findings, onStatusChange]);

  const agents = progress?.agents || {};
  const scope = progress?.scope || {};
  const framework = scope.framework || 'anchor';
  const loc = scope.loc || 0;

  // build severity counts for horizon meter
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    const s = f.severity?.toLowerCase();
    if (s && sevCounts[s] !== undefined) sevCounts[s]++;
  }

  // agent findings grouped
  const agentFindings = {};
  for (const f of findings) {
    if (!agentFindings[f.agent]) agentFindings[f.agent] = [];
    agentFindings[f.agent].push(f);
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <SectionLabel>audit 003 · vault-program</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
        >
          live progress
        </h1>
        <p className="font-mono text-text-tertiary mt-1" style={{ fontSize: '11px' }}>
          five specialized agents · {loc.toLocaleString()} loc · {framework}
        </p>
      </div>

      {/* Agent grid: 2 columns, last card spans full width */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {AGENT_ORDER.map((agentKey, i) => {
          const info = agents[agentKey] || { status: 'pending' };
          const isLast = i === AGENT_ORDER.length - 1;
          return (
            <div
              key={agentKey}
              className={isLast ? 'col-span-2' : ''}
            >
              <AgentCard
                agent={{
                  name: AGENT_DISPLAY[agentKey] || agentKey.replace(/-/g, ' '),
                  status: info.status,
                  currentFile: info.currentFile,
                  duration: info.duration,
                }}
                index={i}
                findings={agentFindings[agentKey] || []}
              />
            </div>
          );
        })}
      </div>

      {/* Horizon meter */}
      <HorizonMeter findings={sevCounts} totalLoc={loc} />

      {/* Collapsible log strip */}
      <div className="mt-6">
        <button
          type="button"
          className="flex items-center gap-2 font-mono text-text-tertiary cursor-pointer"
          style={{ fontSize: '11px' }}
          onClick={() => setLogOpen(!logOpen)}
        >
          <span style={{
            display: 'inline-block',
            transform: logOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 150ms',
          }}>
            ›
          </span>
          agent log
        </button>
        {logOpen && (
          <div
            className="mt-2 bg-bg-recessed font-mono text-text-tertiary overflow-y-auto"
            style={{
              fontSize: '11px',
              lineHeight: '1.6',
              maxHeight: '200px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--color-border-subtle)',
            }}
          >
            {logLines.length === 0 ? (
              <span>no log output yet</span>
            ) : (
              logLines.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
