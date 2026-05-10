/**
 * Prompt injection defenses for untrusted content entering LLM prompts.
 *
 * Attack surfaces mitigated:
 * 1. Source code breaking out of markdown code blocks via triple backticks
 * 2. Finding fields (from prior agents) containing embedded instructions
 * 3. User-supplied free-text (scopeNotes) injecting prompt directives
 * 4. Prescan tool output containing adversarial snippets
 */

// XML-style delimiters that won't appear naturally in Rust/Solana source
const SOURCE_OPEN = '<source-file path="{{PATH}}">';
const SOURCE_CLOSE = '</source-file>';

// Sentinel for re-injected agent output (findings, scout data)
const AGENT_OUTPUT_OPEN = '<agent-output type="{{TYPE}}" trust="unverified">';
const AGENT_OUTPUT_CLOSE = '</agent-output>';

/**
 * Escape source code content so it cannot break out of its delimiter.
 * Replaces any occurrence of opening or closing tags within the content.
 */
function escapeSourceContent(content) {
  return content
    // Escape ALL XML-like tags to prevent prompt injection from adversarial source code.
    // Source code should never contain meaningful XML tags for the LLM.
    .replace(/<\/?[a-zA-Z][\w-]*[^>]*>/g, (match) => match.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    // Neutralize blockquotes that could mimic system messages
    .replace(/^> /gm, '\\> ');
}

/**
 * Format a single source file with escape-resistant XML delimiters.
 * Replaces the old markdown triple-backtick approach.
 */
function wrapSourceFile(filePath, content, loc) {
  const escaped = escapeSourceContent(content);
  const open = SOURCE_OPEN.replace('{{PATH}}', sanitizePlainText(filePath));
  return `${open}\n// ${loc} LOC\n${escaped}\n${SOURCE_CLOSE}`;
}

/**
 * Strip markdown control sequences from untrusted text fields.
 * Used for finding fields, scope notes, and prescan snippets
 * that get interpolated into markdown-formatted prompts.
 */
function sanitizeMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';

  return text
    // Neutralize markdown headings that could create new prompt sections
    .replace(/^(#{1,6})\s/gm, '$1\\# ')
    // Neutralize horizontal rules that look like section dividers
    .replace(/^---+\s*$/gm, '\\---')
    // Neutralize === alternate heading syntax
    .replace(/^===+\s*$/gm, '\\===')
    // Neutralize blockquotes that could mimic system messages
    .replace(/^> /gm, '\\> ')
    // Neutralize bold/emphasis that could mimic prompt formatting
    .replace(/\*\*([A-Z][A-Za-z ]*:)\*\*/g, '$1')
    // Strip ALL XML-style tags that could confuse delimiter parsing
    .replace(/<\/?[a-zA-Z][\w-]*[^>]*>/gi, '[tag-stripped]');
}

/**
 * Sanitize plain text that shouldn't contain any formatting.
 * Allowlist approach — used for IDs, file paths, enums.
 * Only permits alphanumeric, paths, and basic punctuation. Strips newlines.
 */
function sanitizePlainText(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/[\n\r]/g, ' ')
    .replace(/[^a-zA-Z0-9\s/._:@\-]/g, '')
    .slice(0, 500);
}

/**
 * Sanitize a finding object before re-injecting into downstream prompts.
 * Applies markdown sanitization to free-text fields, plain text to constrained fields.
 */
function sanitizeFinding(finding) {
  return {
    id: sanitizePlainText(finding.id),
    title: sanitizeMarkdown(finding.title),
    severity: sanitizePlainText(finding.severity),
    confidence: sanitizePlainText(finding.confidence),
    file: sanitizePlainText(finding.file),
    line: typeof finding.line === 'number' ? finding.line : 0,
    bugClass: sanitizePlainText(finding.bugClass),
    agent: sanitizePlainText(finding.agent),
    description: sanitizeMarkdown(finding.description),
    proof: sanitizeMarkdown(finding.proof),
    recommendation: sanitizeMarkdown(finding.recommendation),
  };
}

/**
 * Wrap re-injected findings in labeled delimiters so system prompts
 * can instruct the model to treat them as unverified agent output.
 */
function wrapFindings(findings, label = 'findings') {
  const open = AGENT_OUTPUT_OPEN.replace('{{TYPE}}', label);
  const sanitized = findings.map(sanitizeFinding);

  const parts = [open, ''];
  for (const f of sanitized) {
    parts.push(`### Finding: ${f.id}`);
    parts.push(`Title: ${f.title}`);
    parts.push(`Severity: ${f.severity} | Confidence: ${f.confidence}`);
    parts.push(`File: ${f.file}:${f.line}`);
    parts.push(`Bug Class: ${f.bugClass}`);
    parts.push(`Description: ${f.description}`);
    parts.push(`Proof: ${f.proof}`);
    if (f.recommendation) {
      parts.push(`Recommendation: ${f.recommendation}`);
    }
    parts.push('');
  }
  parts.push(AGENT_OUTPUT_CLOSE);
  return parts.join('\n');
}

/**
 * Sanitize scope notes (user free-text) before prompt inclusion.
 */
function sanitizeScopeNotes(notes) {
  if (!notes || typeof notes !== 'string') return 'none';
  // Truncate excessive length and sanitize
  return sanitizeMarkdown(notes.slice(0, 1000));
}

/**
 * Validate a finding's constrained fields against allowed values.
 * Returns an array of issues found (empty = valid).
 */
function validateFindingFields(finding) {
  const issues = [];
  const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
  const VALID_CONFIDENCES = ['high', 'medium', 'low'];

  const sev = (finding.severity || '').toLowerCase();
  if (!VALID_SEVERITIES.includes(sev)) {
    issues.push(`invalid severity: "${finding.severity}"`);
  }

  const conf = (finding.confidence || '').toLowerCase();
  if (conf && !VALID_CONFIDENCES.includes(conf)) {
    issues.push(`invalid confidence: "${finding.confidence}"`);
  }

  // ID should match pattern: agent-key-NNN
  if (finding.id && !/^[a-z0-9-]+-\d{3}$/i.test(finding.id)) {
    issues.push(`suspicious id format: "${finding.id}"`);
  }

  // File should look like a file path, not contain prompt injection
  if (finding.file && /[#*<>{}]/.test(finding.file)) {
    issues.push(`suspicious file path: "${finding.file}"`);
  }

  return issues;
}

module.exports = {
  escapeSourceContent,
  wrapSourceFile,
  sanitizeMarkdown,
  sanitizePlainText,
  sanitizeFinding,
  wrapFindings,
  sanitizeScopeNotes,
  validateFindingFields,
  SOURCE_OPEN,
  SOURCE_CLOSE,
  AGENT_OUTPUT_OPEN,
  AGENT_OUTPUT_CLOSE,
};
