import { useState } from 'react';
import SeverityBadge from './SeverityBadge';
import SectionLabel from './SectionLabel';
import MarkdownProse from './MarkdownProse';
import ActionButton from './ActionButton';

export default function DetailPanel({ finding, onVerdict }) {
  const [pocOpen, setPocOpen] = useState(false);
  if (!finding) return null;

  const idLabel = finding.id || 'f-000';
  const agentLabel = finding.agent || '';
  const bugClass = finding.bugClass || '';

  const confidenceLabel = finding.confidence ? `${finding.confidence} conf.` : '';
  const detectionLabel = finding.detection || '';
  const metaParts = [idLabel, agentLabel, bugClass, confidenceLabel, detectionLabel].filter(Boolean).join(' · ');

  return (
    <div
      className="bg-bg-elevated"
      style={{
        border: '0.5px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '18px 20px',
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
        style={{
          fontSize: '13px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={`${finding.file}${finding.line != null ? `:${finding.line}` : ''}`}
      >
        {finding.file}{finding.line != null ? `:${finding.line}` : ''}
      </div>

      {/* Description */}
      <MarkdownProse
        text={finding.description}
        className="text-text-primary mb-4"
      />

      {/* Proof */}
      {finding.proof && (
        <div className="mb-4">
          <div className="mb-2">
            <SectionLabel>proof</SectionLabel>
          </div>
          <MarkdownProse
            text={finding.proof}
            className="text-text-primary"
          />
        </div>
      )}

      {/* Recommendation */}
      {finding.recommendation && (
        <div className="mb-4">
          <div className="mb-2">
            <SectionLabel>recommendation</SectionLabel>
          </div>
          <MarkdownProse
            text={finding.recommendation}
            className="text-text-primary"
          />
        </div>
      )}

      {/* Validation verdict */}
      {finding.validation && (
        <div
          className="mb-4"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: finding.validation.verdict === 'confirmed'
              ? 'rgba(232, 178, 56, 0.06)'
              : finding.validation.verdict === 'refuted'
                ? 'rgba(232, 90, 90, 0.06)'
                : 'rgba(154, 163, 184, 0.06)',
            border: `0.5px solid ${
              finding.validation.verdict === 'confirmed'
                ? 'rgba(232, 178, 56, 0.2)'
                : finding.validation.verdict === 'refuted'
                  ? 'rgba(232, 90, 90, 0.2)'
                  : 'rgba(154, 163, 184, 0.15)'
            }`,
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <SectionLabel>
              validation · {finding.validation.verdict}
              {finding.validation.confidence ? ` · ${finding.validation.confidence} confidence` : ''}
            </SectionLabel>
          </div>
          <p
            className="font-mono text-text-secondary"
            style={{ fontSize: '13px', lineHeight: '1.55' }}
          >
            {finding.validation.reasoning}
          </p>
          {finding.validation.codeEvidence && (
            <pre
              className="font-mono text-text-tertiary mt-2"
              style={{
                fontSize: '13px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {finding.validation.codeEvidence}
            </pre>
          )}

          {/* Attacker model */}
          {finding.validation.attackerModel && (
            <div className="mt-3" style={{ borderTop: '0.5px solid var(--color-border-subtle)', paddingTop: '8px' }}>
              <SectionLabel>attacker model</SectionLabel>
              <div className="font-mono text-text-secondary mt-1" style={{ fontSize: '13px', lineHeight: '1.55' }}>
                <div><span className="text-text-tertiary">who:</span> {finding.validation.attackerModel.who}</div>
                <div><span className="text-text-tertiary">gains:</span> {finding.validation.attackerModel.gains}</div>
                <div><span className="text-text-tertiary">risks:</span> {finding.validation.attackerModel.risks}</div>
              </div>
            </div>
          )}

          {/* Feasibility predicate */}
          {finding.validation.feasibilityPredicate && (
            <div className="mt-3" style={{ borderTop: '0.5px solid var(--color-border-subtle)', paddingTop: '8px' }}>
              <SectionLabel>feasibility</SectionLabel>
              <p className="font-mono text-text-secondary mt-1" style={{ fontSize: '13px', lineHeight: '1.55' }}>
                {finding.validation.feasibilityPredicate}
              </p>
            </div>
          )}

          {/* Conceptual PoC (collapsible) */}
          {finding.validation.conceptualPoc && (
            <div className="mt-3" style={{ borderTop: '0.5px solid var(--color-border-subtle)', paddingTop: '8px' }}>
              <button
                type="button"
                className="flex items-center gap-1.5 font-mono text-text-tertiary cursor-pointer"
                style={{ fontSize: '13px', background: 'none', border: 'none', padding: 0 }}
                onClick={() => setPocOpen(!pocOpen)}
              >
                <span style={{
                  display: 'inline-block',
                  transform: pocOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 150ms',
                }}>›</span>
                conceptual poc
              </button>
              {pocOpen && (
                <pre
                  className="font-mono text-text-secondary mt-2"
                  style={{
                    fontSize: '13px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg-recessed)',
                  }}
                >
                  {finding.validation.conceptualPoc}
                </pre>
              )}
            </div>
          )}

          {/* Backpressure pattern */}
          {finding.validation.backpressurePattern && (
            <div className="mt-3" style={{ borderTop: '0.5px solid var(--color-border-subtle)', paddingTop: '8px' }}>
              <SectionLabel>backpressure pattern</SectionLabel>
              <pre
                className="font-mono text-text-tertiary mt-1"
                style={{ fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {finding.validation.backpressurePattern}
              </pre>
            </div>
          )}

          {/* Calibration */}
          {finding.validation.calibration && (
            <div className="mt-3" style={{ borderTop: '0.5px solid var(--color-border-subtle)', paddingTop: '8px' }}>
              <SectionLabel>calibration</SectionLabel>
              <p className="font-mono text-text-secondary mt-1" style={{ fontSize: '13px', lineHeight: '1.55', fontStyle: 'italic' }}>
                {finding.validation.calibration}
              </p>
            </div>
          )}
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
