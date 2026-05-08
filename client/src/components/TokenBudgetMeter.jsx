import SectionLabel from './SectionLabel';
import { formatTokens, formatCost } from '../utils/format';

const AGENT_ORDER = [
  'scout',
  'accounts-access',
  'cpi-token',
  'arithmetic-economic',
  'state-lifecycle',
  'invariant-logic',
  'deepening',
  'synthesis',
  'validation',
];

const AGENT_SHORT = {
  'scout': 'scout',
  'accounts-access': 'accounts',
  'cpi-token': 'cpi',
  'arithmetic-economic': 'arithmetic',
  'state-lifecycle': 'lifecycle',
  'invariant-logic': 'invariant',
  'deepening': 'deepen',
  'synthesis': 'synthesis',
  'validation': 'validation',
};

export default function TokenBudgetMeter({ agents = {}, maxTokenBudget = 0 }) {
  const agentEntries = AGENT_ORDER
    .filter(k => k in agents && agents[k]?.tokensUsed)
    .map(k => ({ key: k, tokensUsed: agents[k]?.tokensUsed || 0, costUsd: agents[k]?.costUsd || 0 }));

  if (agentEntries.length === 0) return null;

  const totalUsed = agentEntries.reduce((sum, a) => sum + a.tokensUsed, 0);
  const totalCost = agentEntries.reduce((sum, a) => sum + a.costUsd, 0);
  const maxPerAgent = maxTokenBudget
    ? maxTokenBudget / 5
    : Math.max(...agentEntries.map(a => a.tokensUsed)) * 1.2;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>token usage</SectionLabel>
        <span
          className="font-mono text-text-secondary"
          style={{ fontSize: '13px' }}
        >
          {formatTokens(totalUsed)} tokens · {formatCost(totalCost)}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {agentEntries.map(agent => {
          const pct = maxPerAgent > 0 ? Math.min(100, (agent.tokensUsed / maxPerAgent) * 100) : 0;
          return (
            <div key={agent.key} className="flex items-center gap-3">
              <span
                className="font-mono text-text-tertiary"
                style={{ fontSize: '13px', width: '64px', flexShrink: 0, textAlign: 'right' }}
              >
                {AGENT_SHORT[agent.key] || agent.key}
              </span>
              <div
                className="flex-1"
                style={{
                  height: '4px',
                  borderRadius: '2px',
                  background: 'var(--color-bg-recessed)',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: '2px',
                    background: pct > 80
                      ? 'var(--color-dawn-coral)'
                      : 'var(--color-dawn-gold)',
                    transition: 'width 400ms ease-out',
                  }}
                />
              </div>
              <span
                className="font-mono text-text-tertiary"
                style={{ fontSize: '13px', width: '48px', flexShrink: 0 }}
              >
                {formatTokens(agent.tokensUsed)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
