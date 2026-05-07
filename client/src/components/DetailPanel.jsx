import SeverityBadge from './SeverityBadge';
import SectionLabel from './SectionLabel';
import CodeBlock from './CodeBlock';
import ActionButton from './ActionButton';

export default function DetailPanel({ finding, onVerdict }) {
  if (!finding) return null;

  const idLabel = finding.id || 'f-000';
  const agentLabel = finding.agent || '';
  const bugClass = finding.bugClass || '';

  const metaParts = [idLabel, agentLabel, bugClass].filter(Boolean).join(' · ');

  return (
    <div
      className="bg-bg-elevated"
      style={{
        border: '0.5px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '18px 20px',
        marginTop: '16px',
      }}
    >
      {/* Top row: severity + meta label */}
      <div className="flex items-center gap-3 mb-3">
        <SeverityBadge severity={finding.severity} />
        <SectionLabel>{metaParts}</SectionLabel>
      </div>

      {/* Title */}
      <h3
        className="font-display text-text-primary mb-1"
        style={{
          fontSize: '19px',
          lineHeight: '1.25',
          fontWeight: 500,
        }}
      >
        {finding.title}
      </h3>

      {/* File reference */}
      <div
        className="font-mono text-text-secondary mb-4"
        style={{ fontSize: '12px' }}
      >
        {finding.file}{finding.line != null ? `:${finding.line}` : ''}
      </div>

      {/* Description */}
      <p
        className="font-sans text-text-primary mb-4"
        style={{
          fontSize: '13.5px',
          lineHeight: '1.65',
          fontWeight: 400,
        }}
        dangerouslySetInnerHTML={{
          __html: highlightTechnicalTerms(finding.description || ''),
        }}
      />

      {/* Code block */}
      {finding.proof && (
        <div className="mb-4">
          <CodeBlock
            code={finding.proof}
            file={finding.file}
            line={finding.line}
            highlightLines={finding.highlightLines || []}
          />
        </div>
      )}

      {/* Recommendation */}
      {finding.recommendation && (
        <div className="mb-4">
          <div className="mb-2">
            <SectionLabel>recommendation</SectionLabel>
          </div>
          <p
            className="font-sans text-text-primary"
            style={{
              fontSize: '13.5px',
              lineHeight: '1.65',
              fontWeight: 400,
            }}
          >
            {finding.recommendation}
          </p>
        </div>
      )}

      {/* Action row */}
      <div
        className="flex items-center gap-2 pt-4"
        style={{ borderTop: '0.5px solid var(--color-border-subtle)' }}
      >
        <ActionButton
          variant="primary"
          onClick={() => onVerdict?.({ status: 'valid' })}
          aria-keyshortcuts="v"
        >
          mark valid
        </ActionButton>
        <ActionButton onClick={() => onVerdict?.({ status: 'invalid', triageReason: 'invalid' })}>
          invalid
        </ActionButton>
        <ActionButton onClick={() => onVerdict?.({ status: 'not-important', triageReason: 'not important' })}>
          not important
        </ActionButton>
        <ActionButton onClick={() => onVerdict?.({ status: 'out-of-scope', triageReason: 'out of scope' })}>
          out of scope
        </ActionButton>
      </div>
    </div>
  );
}

// Wrap backtick-delimited terms in mono dawn-gold spans
function highlightTechnicalTerms(text) {
  return text.replace(
    /`([^`]+)`/g,
    '<span style="font-family: var(--font-mono); color: var(--color-dawn-gold); font-size: 12px;">$1</span>'
  );
}
