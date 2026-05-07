import { useState, useEffect, useRef } from 'react';
import AgentCard from '../components/AgentCard';
import HorizonMeter from '../components/HorizonMeter';
import TokenBudgetMeter from '../components/TokenBudgetMeter';
import SectionLabel from '../components/SectionLabel';
import ActionButton from '../components/ActionButton';
import { formatDuration } from '../utils/format';

const AGENT_ORDER = [
  'scout',
  'accounts-access',
  'cpi-token',
  'arithmetic-economic',
  'state-lifecycle',
  'invariant-logic',
  'deepening',
  'synthesis',
];

const AGENT_DISPLAY = {
  'scout': 'structural scout',
  'accounts-access': 'accounts & access control',
  'cpi-token': 'cpi & token operations',
  'arithmetic-economic': 'arithmetic & economic',
  'state-lifecycle': 'state lifecycle',
  'invariant-logic': 'invariant & logic',
  'deepening': 'deep analysis',
  'synthesis': 'cross-agent synthesis',
  'validation': 'pessimistic validation',
};

export default function Audit({ onStatusChange }) {
  const [progress, setProgress] = useState(null);
  const [audit, setAudit] = useState(null);
  const [findings, setFindings] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [tick, setTick] = useState(0);
  const [scanStatus, setScanStatus] = useState(null);
  const completionFired = useRef(false);

  useEffect(() => {
    fetch('/api/state/audit').then(r => r.json()).then(data => {
      if (data) setAudit(data);
    }).catch(() => {});
  }, []);

  // Tick every second for elapsed timer while agents are scanning
  useEffect(() => {
    const hasScanning = progress && Object.values(progress.agents || {}).some(
      a => a.status === 'scanning'
    );
    if (!hasScanning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [progress]);

  useEffect(() => {
    let active = true;
    function poll() {
      fetch('/api/state/progress').then(r => r.json()).then(data => {
        if (active) setProgress(data);
      }).catch(() => {});
      fetch('/api/findings').then(r => r.json()).then(data => {
        if (active) setFindings(data.findings || []);
      }).catch(() => {});
      fetch('/api/scan/status').then(r => r.json()).then(data => {
        if (active) setScanStatus(data);
      }).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Completion transition (5.2)
  useEffect(() => {
    if (!progress || completionFired.current) return;
    const allDone = progress.phase === 'done' || progress.phase === 'done-with-errors';
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
  const frameworkLabel = framework === 'anchor' ? 'anchor framework' : framework;
  const loc = scope.loc || 0;

  // Derive audit label from backend state, fall back to generic
  const auditTarget = audit?.repoUrl?.split('/').pop()?.replace('.git', '')
    || audit?.localPath?.split('/').pop()
    || 'program';
  const auditLabel = `audit \u00b7 ${auditTarget}`;

  // Use agents from progress data if available, fall back to defaults
  // Always show validation agent at the end if present
  const scanKeys = Object.keys(agents).length > 0
    ? AGENT_ORDER.filter(k => k in agents)
    : AGENT_ORDER;
  const agentKeys = agents['validation']
    ? [...scanKeys, 'validation']
    : scanKeys;

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

  // Compute max tokens across all agents for shared baseline
  const maxTokensAcrossAgents = Math.max(
    0,
    ...Object.values(agents).map(a => a.tokensUsed || 0)
  );

  // Determine overall scan status
  const isDone = progress?.phase === 'done' || progress?.phase === 'done-with-errors';
  const isScanning = progress && !isDone && progress.phase !== 'cancelled' && progress.phase !== 'error';

  // Timestamps from scan status
  const startedAt = scanStatus?.startedAt;
  const finishedAt = scanStatus?.finishedAt;
  const totalDurationMs = startedAt && finishedAt
    ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    : startedAt && isScanning
      ? Date.now() - new Date(startedAt).getTime()
      : null;

  function formatTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Prescan banner text
  const prescanWarning = progress?.prescanWarning;
  const prescanBannerText = prescanWarning
    ? isDone
      ? 'static analysis was unavailable \u2014 agents ran without pre-narrowed targets'
      : 'static analysis unavailable \u2014 agents running without pre-narrowed targets'
    : null;

  async function retryPrescan() {
    try {
      await fetch('/api/scan/retry-prescan', { method: 'POST' });
    } catch {}
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <SectionLabel>{auditLabel}</SectionLabel>
        <div className="flex items-center gap-3 mt-1">
          <h1
            className="font-display text-text-primary"
            style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
          >
            live progress
          </h1>
          {/* Status chip */}
          <span
            className="inline-flex items-center gap-1.5 font-mono"
            style={{ fontSize: '13px', color: isDone ? 'var(--color-dawn-cream)' : 'var(--color-dawn-magenta)' }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: isDone ? 'var(--color-dawn-cream)' : 'var(--color-dawn-magenta)',
                animation: isScanning ? 'scanning-pulse 1600ms ease-in-out infinite' : 'none',
              }}
            />
            {isDone ? 'complete' : isScanning ? 'scanning' : progress?.phase || 'idle'}
          </span>
        </div>
        <p className="font-mono text-text-tertiary mt-1" style={{ fontSize: '13px' }}>
          {agentKeys.length} agents &middot; {loc.toLocaleString()} loc &middot; {frameworkLabel}
          {startedAt && (
            <>
              {' \u00b7 '}started {formatTime(startedAt)}
              {finishedAt && <> &middot; finished {formatTime(finishedAt)}</>}
              {totalDurationMs != null && <> &middot; {formatDuration(totalDurationMs)}</>}
            </>
          )}
        </p>
      </div>

      {/* Prescan warning banner */}
      {prescanBannerText && (
        <div
          role="alert"
          className="mb-4 font-mono text-dawn-amber flex items-center gap-2"
          style={{
            fontSize: '13px',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(232, 178, 56, 0.08)',
            border: '0.5px solid rgba(232, 178, 56, 0.25)',
          }}
        >
          <span style={{ fontSize: '15px', flexShrink: 0 }}>{'\u26A0'}</span>
          <span className="flex-1">{prescanBannerText}</span>
          {!isDone && (
            <ActionButton onClick={retryPrescan}>retry</ActionButton>
          )}
        </div>
      )}

      {/* Agent grid: uniform 2 columns, responsive */}
      <style>{`
        @media (min-width: 720px) {
          .agent-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
      <div
        className="agent-grid grid gap-3 mb-6"
        style={{
          gridTemplateColumns: 'repeat(1, 1fr)',
        }}
      >
        {agentKeys.map((key, i) => {
          const info = agents[key] || { status: 'pending' };
          return (
            <AgentCard
              key={key}
              agentKey={key}
              agent={{
                name: AGENT_DISPLAY[key] || key.replace(/-/g, ' '),
                status: info.status,
                currentFile: info.startedAt && info.status === 'scanning'
                  ? `scanning (${formatDuration(Date.now() - new Date(info.startedAt).getTime())})`
                  : info.currentFile,
                durationMs: info.durationMs,
                tokensUsed: info.tokensUsed,
                costUsd: info.costUsd,
              }}
              index={i}
              findings={agentFindings[key] || []}
              tokenBudget={audit?.maxTokenBudget || 0}
              costUsd={info.costUsd}
              maxTokensAcrossAgents={maxTokensAcrossAgents}
            />
          );
        })}
      </div>

      {/* Token budget meter */}
      <TokenBudgetMeter agents={agents} maxTokenBudget={audit?.maxTokenBudget || 0} />

      {/* Horizon meter */}
      <HorizonMeter findings={sevCounts} totalLoc={loc} />

      {/* Collapsible log strip — only when there are log lines */}
      {logLines.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            className="flex items-center gap-2 font-mono text-text-tertiary cursor-pointer"
            style={{ fontSize: '13px' }}
            onClick={() => setLogOpen(!logOpen)}
          >
            <span style={{
              display: 'inline-block',
              transform: logOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms',
            }}>
              &rsaquo;
            </span>
            agent log
          </button>
          {logOpen && (
            <div
              className="mt-2 bg-bg-recessed font-mono text-text-tertiary overflow-y-auto"
              style={{
                fontSize: '13px',
                lineHeight: '1.6',
                maxHeight: '200px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--color-border-subtle)',
              }}
            >
              {logLines.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
