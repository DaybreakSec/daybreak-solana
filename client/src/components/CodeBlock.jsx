/**
 * Rust-aware syntax highlighter for Solana audit code proofs.
 * Accepts raw Rust source; no pre-baked HTML needed.
 *
 * Token colors (dawn palette):
 *   keyword    → dawn-magenta  #E85A8C
 *   type       → dawn-gold     #F5D78E
 *   attribute  → dawn-amber    #F5A65B
 *   string     → dawn-coral    #ED7F65
 *   comment    → text-tertiary #5F6885
 *   default    → text-primary  (inherited)
 */

const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
  'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
  'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
  'unsafe', 'use', 'where', 'while', 'yield',
]);

const BUILTIN_TYPES = new Set([
  'u8', 'u16', 'u32', 'u64', 'u128', 'i8', 'i16', 'i32', 'i64', 'i128',
  'f32', 'f64', 'bool', 'char', 'str', 'usize', 'isize',
  'String', 'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc',
]);

const COLORS = {
  keyword: '#E85A8C',
  type:    '#F5D78E',
  attr:    '#F5A65B',
  string:  '#ED7F65',
  comment: '#5F6885',
};

function tokenizeLine(line) {
  const tokens = [];
  let i = 0;

  while (i < line.length) {
    // Comment
    if (line[i] === '/' && line[i + 1] === '/') {
      tokens.push({ type: 'comment', text: line.slice(i) });
      break;
    }

    // Attribute: #[...] (handles nested parens inside brackets)
    if (line[i] === '#' && line[i + 1] === '[') {
      let depth = 0;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '[') depth++;
        else if (line[j] === ']') { depth--; if (depth === 0) { j++; break; } }
        j++;
      }
      tokens.push({ type: 'attr', text: line.slice(i, j) });
      i = j;
      continue;
    }

    // String literal
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\') j++;
        j++;
      }
      j++;
      tokens.push({ type: 'string', text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Lifetime or char: 'info, 'a, 'static
    if (line[i] === "'" && i + 1 < line.length && /[a-zA-Z_]/.test(line[i + 1])) {
      let j = i + 1;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      tokens.push({ type: 'string', text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Word (identifier / keyword / type)
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);

      if (KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', text: word });
      } else if (BUILTIN_TYPES.has(word) || /^[A-Z]/.test(word)) {
        tokens.push({ type: 'type', text: word });
      } else {
        tokens.push({ type: 'default', text: word });
      }
      i = j;
      continue;
    }

    // Number literal
    if (/[0-9]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[0-9a-fA-Fx_]/.test(line[j])) j++;
      tokens.push({ type: 'default', text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Everything else (operators, punctuation, whitespace)
    tokens.push({ type: 'default', text: line[i] });
    i++;
  }

  return tokens;
}

function HighlightedLine({ text }) {
  const tokens = tokenizeLine(text);
  return tokens.map((tok, i) =>
    tok.type === 'default'
      ? <span key={i}>{tok.text}</span>
      : <span key={i} style={{ color: COLORS[tok.type] }}>{tok.text}</span>
  );
}

export default function CodeBlock({ code, language = 'rust', file, line, highlightLines = [] }) {
  const lines = (code || '').split('\n');

  return (
    <div
      className="bg-bg-recessed overflow-hidden"
      style={{
        borderRadius: 'var(--radius-md)',
        border: '0.5px solid var(--color-border-subtle)',
      }}
    >
      {(file || line != null) && (
        <div
          className="font-mono text-text-secondary px-4 py-2"
          style={{
            fontSize: '13px',
            borderBottom: '0.5px solid var(--color-border-subtle)',
          }}
        >
          {file}{line != null ? `:${line}` : ''}
        </div>
      )}
      <pre
        className="font-mono text-text-primary overflow-x-auto"
        style={{
          fontSize: '13px',
          lineHeight: '1.7',
          padding: '14px 16px',
          margin: 0,
          whiteSpace: 'pre',
        }}
      >
        <code>
          {lines.map((ln, i) => {
            const lineNum = (line || 1) + i;
            const isHighlighted = highlightLines.includes(lineNum) || highlightLines.includes(i);
            return (
              <span
                key={i}
                style={isHighlighted ? {
                  display: 'block',
                  background: 'rgba(214, 72, 120, 0.14)',
                  margin: '0 -16px',
                  padding: '0 16px',
                } : { display: 'block' }}
              >
                <HighlightedLine text={ln} />
                {ln === '' && '\n'}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
