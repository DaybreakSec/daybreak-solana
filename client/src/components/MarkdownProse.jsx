import CodeBlock from './CodeBlock';

/**
 * Renders markdown-like text with support for:
 * - Fenced code blocks (```lang ... ```)
 * - Inline code (`foo`)
 * - **bold**, *italic*, [links](url)
 * - Headings (#, ##, ###)
 * - Lists (-, *, numbered) with indent detection for nesting
 * - Paragraphs (double newlines)
 * - Single newlines as <br>
 */
export default function MarkdownProse({ text, className, style }) {
  if (!text) return null;

  const blocks = splitFencedBlocks(text);

  return (
    <div className={className} style={style}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <div key={i} className="my-3">
              <CodeBlock code={block.content} language={block.lang || 'rust'} />
            </div>
          );
        }
        // Prose block: render with structure
        return <ProseBlock key={i} content={block.content} />;
      })}
    </div>
  );
}

function ProseBlock({ content }) {
  const lines = content.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="font-display text-text-primary mt-4 mb-1" style={{ fontSize: '17px', fontWeight: 500, lineHeight: '1.35' }}>
          {renderInline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="font-display text-text-primary mt-5 mb-1" style={{ fontSize: '19px', fontWeight: 500, lineHeight: '1.25' }}>
          {renderInline(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="font-display text-text-primary mt-5 mb-2" style={{ fontSize: '22px', fontWeight: 500, lineHeight: '1.2' }}>
          {renderInline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '0.5px solid var(--color-border-subtle)', margin: '12px 0' }} />);
      i++;
      continue;
    }

    // Table rows
    if (line.startsWith('|')) {
      elements.push(
        <p key={i} className="font-mono text-text-secondary" style={{ fontSize: '13px' }}>
          {line}
        </p>
      );
      i++;
      continue;
    }

    // List items (-, *, or numbered)
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (listMatch) {
      const indent = Math.floor(listMatch[1].length / 2);
      elements.push(
        <p
          key={i}
          style={{
            fontSize: '15px',
            lineHeight: '1.65',
            paddingLeft: `${16 + indent * 16}px`,
          }}
        >
          {'\u2022 '}{renderInline(listMatch[3])}
        </p>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} style={{ fontSize: '15px', lineHeight: '1.65', fontWeight: 400 }}>
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <>{elements}</>;
}

/**
 * Split text into alternating prose and fenced-code blocks.
 */
function splitFencedBlocks(text) {
  const blocks = [];
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const prose = text.slice(lastIndex, match.index).trim();
      if (prose) blocks.push({ type: 'prose', content: prose });
    }
    blocks.push({ type: 'code', lang: match[1] || 'rust', content: match[2].replace(/\n$/, '') });
    lastIndex = fenceRe.lastIndex;
  }

  if (lastIndex < text.length) {
    const prose = text.slice(lastIndex).trim();
    if (prose) blocks.push({ type: 'prose', content: prose });
  }

  return blocks;
}

/**
 * Render inline content: backtick code spans, **bold**, *italic*, [links](url), line breaks.
 */
function renderInline(text) {
  // Tokenize: split on inline patterns
  const tokens = [];
  // Regex to match inline code, bold, italic, and links
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      tokens.push({ type: 'text', content: text.slice(lastIdx, m.index) });
    }
    const tok = m[0];
    if (tok.startsWith('`')) {
      tokens.push({ type: 'code', content: tok.slice(1, -1) });
    } else if (tok.startsWith('**')) {
      tokens.push({ type: 'bold', content: tok.slice(2, -2) });
    } else if (tok.startsWith('*')) {
      tokens.push({ type: 'italic', content: tok.slice(1, -1) });
    } else if (tok.startsWith('[')) {
      const linkMatch = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        tokens.push({ type: 'link', content: linkMatch[1], url: linkMatch[2] });
      }
    }
    lastIdx = re.lastIndex;
  }

  if (lastIdx < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIdx) });
  }

  return tokens.map((tok, i) => {
    if (tok.type === 'code') {
      return (
        <span
          key={i}
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-dawn-gold)',
            fontSize: '13px',
            background: 'rgba(245, 215, 142, 0.06)',
            padding: '1px 4px',
            borderRadius: '3px',
          }}
        >
          {tok.content}
        </span>
      );
    }
    if (tok.type === 'bold') {
      return <strong key={i} style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{tok.content}</strong>;
    }
    if (tok.type === 'italic') {
      return <em key={i} style={{ fontStyle: 'italic' }}>{tok.content}</em>;
    }
    if (tok.type === 'link') {
      const isSafeUrl = /^https?:\/\//i.test(tok.url);
      if (!isSafeUrl) {
        return <span key={i}>{tok.content}</span>;
      }
      return (
        <a
          key={i}
          href={tok.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--color-dawn-amber)', textDecoration: 'underline' }}
        >
          {tok.content}
        </a>
      );
    }
    // Plain text: handle newlines
    const lines = tok.content.split('\n');
    const parts = [];
    for (let j = 0; j < lines.length; j++) {
      if (j > 0) parts.push(<br key={`br-${i}-${j}`} />);
      if (lines[j]) parts.push(<span key={`${i}-${j}`}>{lines[j]}</span>);
    }
    return parts;
  });
}
