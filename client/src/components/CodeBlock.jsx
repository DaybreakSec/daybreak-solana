/**
 * Syntax token colors (applied via spans in seed data):
 *   Keywords (pub, struct, fn, use, impl, mod)  → dawn-magenta (#E85A8C)
 *   Types (Account, AccountInfo, Vault)          → dawn-gold   (#F5D78E)
 *   Attributes (#[derive(...)], #[account(...)])  → dawn-amber  (#F5A65B)
 *   Strings                                       → dawn-coral  (#ED7F65)
 *   Comments                                      → text-tertiary (#5F6885)
 *   Default                                       → text-primary (#F5EFE6)
 *
 * Highlighted (offending) lines: wrap in <span> with class "code-highlight".
 */

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
            fontSize: '11px',
            borderBottom: '0.5px solid var(--color-border-subtle)',
          }}
        >
          {file}{line != null ? `:${line}` : ''}
        </div>
      )}
      <pre
        className="font-mono text-text-primary overflow-x-auto"
        style={{
          fontSize: '12px',
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
                dangerouslySetInnerHTML={{ __html: ln || '\n' }}
              />
            );
          })}
        </code>
      </pre>
    </div>
  );
}
