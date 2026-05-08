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
              <ThreatCategoryAccordion categories={data.threatCategories} />
            </Section>
          )}

          {/* Key Risks */}
          {data.keyRisks && data.keyRisks.length > 0 && (
            <Section title="key risks">
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {data.keyRisks.map((r, i) => (
                  <li
                    key={i}
                    className="text-text-secondary"
                    style={{ fontSize: '14px', lineHeight: '1.6', marginBottom: '4px' }}
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Recommended Focus */}
          {data.recommendedFocus && data.recommendedFocus.length > 0 && (
            <Section title="recommended focus">
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {data.recommendedFocus.map((f, i) => (
                  <li
                    key={i}
                    className="text-text-secondary"
                    style={{ fontSize: '14px', lineHeight: '1.6', marginBottom: '4px' }}
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Attack Narratives */}
          {data.attackNarratives && data.attackNarratives.length > 0 && (
            <Section title="attack narratives">
              <AttackNarrativeCards narratives={data.attackNarratives} />
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
          {as.instructions && as.instructions.length > 0 && (
            <div className="font-mono text-text-tertiary" style={{ fontSize: '13px', marginBottom: '4px' }}>
              {as.instructions.join(', ')}
            </div>
          )}
          {as.attackVectors && as.attackVectors.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px' }}>
              {as.attackVectors.map((v, j) => (
                <li
                  key={j}
                  className="text-text-secondary"
                  style={{ fontSize: '13px', lineHeight: '1.5' }}
                >
                  {v}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ThreatCategoryAccordion({ categories }) {
  const [openCats, setOpenCats] = useState({});

  function toggle(cat) {
    setOpenCats(prev => ({ ...prev, [cat]: !prev[cat] }));
  }

  return (
    <div className="space-y-1">
      {categories.map((cat) => {
        const label = cat.category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const threatCount = (cat.threats || []).length;
        const isOpen = openCats[cat.category];

        return (
          <div key={cat.category}>
            <button
              type="button"
              className="flex items-center gap-2 w-full font-mono text-text-secondary cursor-pointer"
              style={{ fontSize: '13px', padding: '6px 0' }}
              onClick={() => toggle(cat.category)}
            >
              <span style={{
                display: 'inline-block',
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms',
              }}>
                &rsaquo;
              </span>
              {label}
              <span className="text-text-tertiary">({threatCount} threats)</span>
            </button>
            {isOpen && cat.threats && (
              <div style={{ paddingLeft: '16px', paddingBottom: '8px' }}>
                {cat.threats.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: '8px 0',
                      borderBottom: '0.5px solid var(--color-border-subtle)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-text-tertiary" style={{ fontSize: '12px' }}>
                        {t.id}
                      </span>
                      <span className="font-mono text-text-primary" style={{ fontSize: '13px' }}>
                        {t.title}
                      </span>
                    </div>
                    <div className="font-mono text-text-secondary" style={{ fontSize: '13px', lineHeight: '1.5' }}>
                      {t.description}
                    </div>
                    <div className="flex gap-3 mt-1">
                      <span className="font-mono" style={{ fontSize: '12px', color: RISK_COLORS[t.impact] }}>
                        impact: {t.impact}
                      </span>
                      <span className="font-mono text-text-tertiary" style={{ fontSize: '12px' }}>
                        likelihood: {t.likelihood}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AttackNarrativeCards({ narratives }) {
  const [openNarr, setOpenNarr] = useState({});

  function toggle(idx) {
    setOpenNarr(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  return (
    <div className="space-y-1">
      {narratives.map((an, i) => {
        const isOpen = openNarr[i];

        return (
          <div key={i}>
            <button
              type="button"
              className="flex items-center gap-2 w-full font-mono text-text-secondary cursor-pointer"
              style={{ fontSize: '13px', padding: '6px 0' }}
              onClick={() => toggle(i)}
            >
              <span style={{
                display: 'inline-block',
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms',
              }}>
                &rsaquo;
              </span>
              <span className="text-text-primary">{an.title}</span>
              <span
                className="font-mono"
                style={{
                  fontSize: '12px',
                  color: RISK_COLORS[an.estimatedSeverity] || 'var(--color-text-tertiary)',
                }}
              >
                [{an.estimatedSeverity}]
              </span>
            </button>
            {isOpen && (
              <div
                style={{
                  paddingLeft: '16px',
                  paddingBottom: '12px',
                }}
              >
                <div
                  className="text-text-secondary"
                  style={{ fontSize: '14px', lineHeight: '1.6', marginBottom: '8px' }}
                >
                  {an.narrative}
                </div>
                {an.preconditions && an.preconditions.length > 0 && (
                  <div>
                    <span
                      className="font-mono text-text-tertiary"
                      style={{ fontSize: '12px', fontWeight: 500 }}
                    >
                      preconditions:
                    </span>
                    <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
                      {an.preconditions.map((p, j) => (
                        <li
                          key={j}
                          className="text-text-tertiary"
                          style={{ fontSize: '13px', lineHeight: '1.5' }}
                        >
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
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
