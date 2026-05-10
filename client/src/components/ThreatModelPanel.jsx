import { useState } from 'react';
import SectionLabel from './SectionLabel';
import MarkdownProse from './MarkdownProse';
import ActionButton from './ActionButton';

const RISK_COLORS = {
  critical: 'var(--color-sev-critical)',
  high: 'var(--color-sev-high)',
  medium: 'var(--color-sev-medium)',
  low: 'var(--color-sev-low)',
};

const TRUST_COLORS = {
  untrusted: 'var(--color-sev-critical)',
  'semi-trusted': 'var(--color-sev-medium)',
  trusted: 'var(--color-sev-low)',
};

const IMPORTANCE_COLORS = {
  critical: 'var(--color-sev-critical)',
  high: 'var(--color-sev-high)',
  medium: 'var(--color-sev-medium)',
};

const RELEVANCE_COLORS = {
  high: 'var(--color-dawn-coral)',
  medium: 'var(--color-dawn-amber)',
  low: 'var(--color-text-tertiary)',
};

export default function ThreatModelPanel({ data, status, onDownload }) {
  const [expanded, setExpanded] = useState(true);

  if (!data && status !== 'scanning') return null;

  const isLoading = status === 'scanning' || status === 'queued';
  const hasError = status === 'error';

  const statusLabel = isLoading ? 'generating' : hasError ? 'error' : 'complete';
  const statusColor = isLoading
    ? 'var(--color-dawn-magenta)'
    : hasError
      ? 'var(--color-sev-critical)'
      : 'var(--color-dawn-cream)';

  return (
    <div
      className="mb-6"
      style={{
        background: 'var(--color-bg-elevated)',
        borderRadius: 'var(--radius-xl)',
        border: '0.5px solid var(--color-border-default)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between cursor-pointer"
        style={{ padding: '14px 18px' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <SectionLabel>threat model</SectionLabel>
          <span
            className="inline-flex items-center gap-1.5 font-mono"
            style={{ fontSize: '13px', color: statusColor }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: statusColor,
                animation: isLoading ? 'scanning-pulse 1600ms ease-in-out infinite' : 'none',
              }}
            />
            {statusLabel}
          </span>
        </div>
        <span
          className="text-text-tertiary"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 150ms',
            fontSize: '16px',
          }}
        >
          &rsaquo;
        </span>
      </button>

      {/* Body */}
      {expanded && data && (
        <div style={{ padding: '0 18px 18px' }}>
          {/* Executive Summary */}
          {data.executiveSummary && (
            <div style={{ marginBottom: '16px' }}>
              <MarkdownProse
                text={data.executiveSummary}
                className="text-text-secondary"
                style={{ fontSize: '15px', lineHeight: '1.65' }}
              />
            </div>
          )}

          {/* Program Summary Row */}
          {data.programSummary && (
            <ProgramSummaryRow summary={data.programSummary} />
          )}

          {/* Actors */}
          {data.actors && data.actors.length > 0 && (
            <Section title="actors">
              <ActorChips actors={data.actors} />
            </Section>
          )}

          {/* Trust Boundaries */}
          {data.trustBoundaries && data.trustBoundaries.length > 0 && (
            <Section title="trust boundaries">
              <TrustBoundaryList boundaries={data.trustBoundaries} />
            </Section>
          )}

          {/* Invariants */}
          {data.invariants && data.invariants.length > 0 && (
            <Section title="invariants">
              <InvariantList invariants={data.invariants} />
            </Section>
          )}

          {/* Attack Surfaces */}
          {data.attackSurfaces && data.attackSurfaces.length > 0 && (
            <Section title="attack surfaces">
              <AttackSurfaceCards
                surfaces={[...data.attackSurfaces].sort(
                  (a, b) => severityRank(a.threatLevel) - severityRank(b.threatLevel)
                )}
              />
            </Section>
          )}

          {/* Threat Categories */}
          {data.threatCategories && data.threatCategories.length > 0 && (
            <Section title="threat categories">
              <ThreatCategoryCards categories={data.threatCategories} />
            </Section>
          )}

          {/* Download button */}
          {onDownload && (
            <div style={{ marginTop: '16px' }}>
              <ActionButton onClick={onDownload}>
                download threat model .md
              </ActionButton>
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {expanded && isLoading && !data && (
        <div
          className="font-mono text-text-tertiary"
          style={{ padding: '12px 18px 18px', fontSize: '13px' }}
        >
          analyzing program structure...
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div
      style={{
        padding: '12px 0',
        borderTop: '0.5px solid var(--color-border-subtle)',
      }}
    >
      <div
        className="font-mono text-text-tertiary"
        style={{ fontSize: '13px', marginBottom: '8px', fontWeight: 500, letterSpacing: '0.06em' }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ProgramSummaryRow({ summary }) {
  const chips = [
    `${summary.instructionCount} instructions`,
    summary.handlesFunds ? 'handles funds' : null,
    summary.usesOracles ? 'uses oracles' : null,
    summary.framework,
    `${summary.complexityProfile} complexity`,
  ].filter(Boolean);

  return (
    <div
      className="font-mono text-text-secondary"
      style={{
        fontSize: '13px',
        padding: '8px 0',
        borderTop: '0.5px solid var(--color-border-subtle)',
      }}
    >
      {chips.join(' \u00b7 ')}
    </div>
  );
}

function ActorChips({ actors }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actors.map((a) => {
        const ixCount = (a.instructions || []).length;
        return (
          <span
            key={a.id}
            className="inline-flex items-center gap-1.5 font-mono"
            style={{
              fontSize: '13px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--color-border-default)',
              background: 'var(--color-bg-elevated-2)',
            }}
            title={a.description}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: TRUST_COLORS[a.trustLevel] || 'var(--color-text-tertiary)' }}
            />
            <span className="text-text-primary">{a.label}</span>
            <span className="text-text-tertiary">{ixCount} ix</span>
          </span>
        );
      })}
    </div>
  );
}

function TrustBoundaryList({ boundaries }) {
  return (
    <div className="space-y-2">
      {boundaries.map((tb, i) => (
        <div key={i} className="flex items-start gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
            style={{ background: RISK_COLORS[tb.riskLevel] || 'var(--color-text-tertiary)' }}
          />
          <div>
            <span className="font-mono text-text-primary" style={{ fontSize: '13px' }}>
              {tb.name}
            </span>
            <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
              {' '}({tb.riskLevel})
            </span>
            {tb.crossedBy && tb.crossedBy.length > 0 && (
              <span className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
                {' \u2014 '}{tb.crossedBy.join(', ')}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function InvariantList({ invariants }) {
  // Group by type
  const grouped = {};
  for (const inv of invariants) {
    if (!grouped[inv.type]) grouped[inv.type] = [];
    grouped[inv.type].push(inv);
  }

  const TYPE_LABELS = { funds: 'fund conservation', access: 'access separation', state: 'state consistency' };
  const typeOrder = ['funds', 'access', 'state'];

  return (
    <div className="space-y-3">
      {typeOrder.filter(t => grouped[t]).map(type => (
        <div key={type}>
          <div
            className="font-mono text-text-tertiary"
            style={{ fontSize: '12px', marginBottom: '6px', fontWeight: 500, letterSpacing: '0.05em' }}
          >
            {TYPE_LABELS[type] || type}
          </div>
          <div className="space-y-1.5">
            {grouped[type].map((inv) => (
              <div
                key={inv.id}
                className="flex items-start gap-2"
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-recessed)',
                }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: IMPORTANCE_COLORS[inv.importance] || 'var(--color-text-tertiary)' }}
                />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-text-primary" style={{ fontSize: '13px' }}>
                    {inv.property}
                  </span>
                  <div className="font-mono text-text-tertiary" style={{ fontSize: '12px', marginTop: '2px' }}>
                    {inv.id} &middot; {inv.scope}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttackSurfaceCards({ surfaces }) {
  return (
    <div className="space-y-3">
      {surfaces.map((as, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            border: '0.5px solid var(--color-border-subtle)',
            background: 'var(--color-bg-recessed)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: RISK_COLORS[as.threatLevel] || 'var(--color-text-tertiary)' }}
            />
            <span className="font-mono text-text-primary" style={{ fontSize: '13px', fontWeight: 500 }}>
              {as.name}
            </span>
          </div>
          <div
            className="font-mono text-text-secondary"
            style={{ fontSize: '13px', lineHeight: '1.5', marginBottom: '6px' }}
          >
            {as.description}
          </div>
          {as.instructions && as.instructions.length > 0 && (
            <div className="font-mono text-text-tertiary" style={{ fontSize: '12px', marginBottom: '4px' }}>
              {as.instructions.join(', ')}
            </div>
          )}
          {as.exposureFactors && as.exposureFactors.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: '6px' }}>
              {as.exposureFactors.map((factor, j) => (
                <span
                  key={j}
                  className="font-mono text-text-tertiary"
                  style={{
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '0.5px solid var(--color-border-subtle)',
                    background: 'var(--color-bg-elevated)',
                  }}
                >
                  {factor}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ThreatCategoryCards({ categories }) {
  // Sort by relevance: high first
  const sorted = [...categories].sort(
    (a, b) => relevanceRank(a.relevance) - relevanceRank(b.relevance)
  );

  return (
    <div className="space-y-2">
      {sorted.map((cat) => {
        const label = cat.category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const ixCount = (cat.affectedInstructions || []).length;

        return (
          <div
            key={cat.category}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--color-border-subtle)',
              background: 'var(--color-bg-recessed)',
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: RELEVANCE_COLORS[cat.relevance] || 'var(--color-text-tertiary)' }}
              />
              <span className="font-mono text-text-primary" style={{ fontSize: '13px', fontWeight: 500 }}>
                {label}
              </span>
              <span className="font-mono text-text-tertiary" style={{ fontSize: '12px' }}>
                {cat.relevance} &middot; {ixCount} ix
              </span>
            </div>
            <div
              className="font-mono text-text-secondary"
              style={{ fontSize: '13px', lineHeight: '1.5' }}
            >
              {cat.summary}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function severityRank(level) {
  const ranks = { critical: 0, high: 1, medium: 2, low: 3 };
  return ranks[level] ?? 4;
}

function relevanceRank(level) {
  const ranks = { high: 0, medium: 1, low: 2 };
  return ranks[level] ?? 3;
}
