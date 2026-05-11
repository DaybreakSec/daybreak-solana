const puppeteer = require('puppeteer');

// ── Design tokens ────────────────────────────────────────────────────
const T = {
  bgPage:      '#0F1729',
  bgPanel:     '#1A2138',
  bgInset:     '#080E1F',
  textPrimary:   '#F5EFE6',
  textSecondary: '#B8C0D1',
  textTertiary:  '#8892AB',
  dawnMagenta: '#E85A8C',
  dawnCoral:   '#ED7F65',
  dawnAmber:   '#F5A65B',
  dawnGold:    '#F5D78E',
  borderSubtle:  'rgba(245, 239, 230, 0.06)',
  borderDefault: 'rgba(245, 239, 230, 0.10)',
  borderStrong:  'rgba(245, 239, 230, 0.22)',
  sev: {
    critical:      { bg: '#DC2626', text: '#450A0A' },
    high:          { bg: '#F08D4A', text: '#4A1B0C' },
    medium:        { bg: '#E8C26B', text: '#633806' },
    low:           { bg: '#7A92C4', text: '#042C53' },
    informational: { bg: '#8B95A8', text: '#1A2138' },
  },
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational'];
const SEVERITY_LABELS = {
  critical: 'Critical', high: 'High', medium: 'Medium',
  low: 'Low', informational: 'Informational',
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Normalize unicode operators that LLMs often emit in code.
 */
function normalizeCode(str) {
  if (!str) return '';
  return str
    .replace(/\u2265/g, '>=')   // ≥
    .replace(/\u2264/g, '<=')   // ≤
    .replace(/\u2260/g, '!=')   // ≠
    .replace(/\u2192/g, '->')   // →
    .replace(/\u2190/g, '<-')   // ←
    .replace(/\u21D2/g, '=>')   // ⇒
    .replace(/\u2026/g, '...')  // …
    .replace(/\u201C/g, '"')    // "
    .replace(/\u201D/g, '"')    // "
    .replace(/\u2018/g, "'")    // '
    .replace(/\u2019/g, "'");   // '
}

function renderMarkdown(text) {
  if (!text) return '';

  // Normalize unicode operators inside code before HTML-escaping
  let processed = text;
  processed = processed.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    '```' + lang + '\n' + normalizeCode(code) + '```'
  );
  processed = processed.replace(/`([^`]+)`/g, (_, code) => '`' + normalizeCode(code) + '`');

  let html = escapeHtml(processed);

  // Code blocks preceded by a line reference (e.g. "Lines 73-78:")
  html = html.replace(/[Ll]ines?\s+(\d+)(?:\s*[-\u2013\u2014]\s*\d+)?\s*:?\s*\n```\w*\n([\s\S]*?)```/g,
    (_, lineRef, code) => {
      const start = parseInt(lineRef, 10);
      const lines = code.trim().split('\n');
      const lineEls = lines.map((line, i) =>
        `<span class="ln" data-ln="${start + i}">${line || '&nbsp;'}</span>`
      ).join('\n');
      return `<div class="code-block"><div class="body">${lineEls}</div></div>`;
    });

  // Remaining code blocks (no line reference, start at 1)
  html = html.replace(/```\w*\n([\s\S]*?)```/g, (_, code) => {
    const lines = code.trim().split('\n');
    const lineEls = lines.map((line, i) =>
      `<span class="ln" data-ln="${i + 1}">${line || '&nbsp;'}</span>`
    ).join('\n');
    return `<div class="code-block"><div class="body">${lineEls}</div></div>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<div class="code-block"')) return p;

    const lines = p.split('\n');
    const isBullet = lines.every(l => /^[-*]\s/.test(l.trim()) || !l.trim());
    if (isBullet) {
      const items = lines.filter(l => l.trim()).map(l => `<li>${l.replace(/^[-*]\s+/, '')}</li>`);
      return `<ul>${items.join('')}</ul>`;
    }
    const isNum = lines.every(l => /^\d+\.\s/.test(l.trim()) || !l.trim());
    if (isNum) {
      const items = lines.filter(l => l.trim()).map(l => `<li>${l.replace(/^\d+\.\s+/, '')}</li>`);
      return `<ol>${items.join('')}</ol>`;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // Callout styling for labeled paragraphs (Example:, Attack:, etc.)
  html = html.replace(/<p><strong>(Example|Attack|Impact|Note|Scenario|Warning)[^<]*:<\/strong>/gi,
    (match) => match.replace('<p>', '<p class="callout">'));

  return html;
}

function sevBadge(severity) {
  const s = T.sev[severity] || T.sev.informational;
  const label = SEVERITY_LABELS[severity] || severity;
  return `<span class="sev-badge" style="background:${s.bg};color:${s.text}">${label}</span>`;
}

function sevDot(severity) {
  const s = T.sev[severity] || T.sev.informational;
  return `<span class="sev-dot" style="background:${s.bg}"></span>`;
}

const AGENT_SHORT = {
  'arithmetic-economic': 'ARITH',
  'accounts-access': 'ACCESS',
  'cpi-token': 'CPI',
  'state-lifecycle': 'STATE',
  'invariant-logic': 'LOGIC',
  'synthesis': 'SYNTH',
};

/**
 * Compress long agent-based IDs for PDF display.
 * e.g. "arithmetic-economic-001" → "ARITH-001"
 */
function shortId(id) {
  if (!id) return '';
  const match = id.match(/^(.+)-(\d+)$/);
  if (!match) return id.toUpperCase();
  const [, agentKey, num] = match;
  const short = AGENT_SHORT[agentKey];
  if (short) return `${short}-${num}`;
  return agentKey.split('-').map(w => w.slice(0, 4).toUpperCase()).join('-') + '-' + num;
}

// ── Cover ────────────────────────────────────────────────────────────
function renderCover(audit, findings, scope) {
  const name = audit.repoUrl
    ? audit.repoUrl.split('/').pop().replace('.git', '')
    : audit.localPath ? audit.localPath.split('/').pop() : 'Program';
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const year = new Date().getFullYear();
  const framework = scope?.framework || 'anchor';
  const totalLoc = scope?.total_loc || scope?.files?.reduce((s, f) => s + f.loc, 0) || 0;

  const bySev = {};
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

  const barSegments = SEVERITY_ORDER
    .filter(s => bySev[s])
    .map(s => {
      const pct = (bySev[s] / findings.length) * 100;
      return `<div class="seg-${s}" style="width:${pct}%"></div>`;
    }).join('');

  const pills = SEVERITY_ORDER
    .filter(s => bySev[s])
    .map(s => {
      const cls = s === 'informational' ? 'info' : s;
      return `<span class="sev-pill ${cls}"><span class="dot"></span><span class="count">${bySev[s]}</span> ${SEVERITY_LABELS[s]}</span>`;
    }).join('');

  return `
    <div class="cover">
      <div class="cover-brand">
        <span class="name">Daybreak</span>
        <span class="suffix">SECURITY</span>
      </div>
      <div class="cover-eyebrow">SECURITY AUDIT REPORT</div>
      <h1 class="cover-title">Security audit report</h1>
      <div class="cover-subject">${escapeHtml(name)}.</div>
      <div class="cover-meta">
        <div class="item"><span class="key">DATE</span><span class="val">${date}</span></div>
        <div class="item"><span class="key">FRAMEWORK</span><span class="val">${escapeHtml(framework)}</span></div>
        <div class="item"><span class="key">LOC</span><span class="val">${totalLoc.toLocaleString()}</span></div>
        <div class="item"><span class="key">FINDINGS</span><span class="val">${findings.length}</span></div>
      </div>
      <div class="cover-severity">
        <div class="label">SEVERITY DISTRIBUTION</div>
        <div class="severity-bar">${barSegments}</div>
        <div class="severity-pills">${pills}</div>
      </div>
      <div class="cover-footer">
        <span class="left">Daybreak Security</span>
        <span class="right">daybreaksec.com &middot; ${year}</span>
      </div>
    </div>`;
}

// ── TOC ──────────────────────────────────────────────────────────────
function renderTOC(findings, hasThreatModel) {
  const bySev = {};
  for (const f of findings) {
    if (!bySev[f.severity]) bySev[f.severity] = [];
    bySev[f.severity].push(f);
  }

  let num = 1;
  const items = [];
  items.push(`<li><span class="num">${String(num++).padStart(2, '0')}</span><span class="title">Executive Summary</span></li>`);
  if (hasThreatModel) {
    items.push(`<li><span class="num">${String(num++).padStart(2, '0')}</span><span class="title">Threat Model</span></li>`);
  }
  items.push(`<li><span class="num">${String(num++).padStart(2, '0')}</span><span class="title">Findings</span></li>`);

  for (const sev of SEVERITY_ORDER) {
    const group = bySev[sev];
    if (!group || group.length === 0) continue;
    items.push(`<div class="toc-group-label">${SEVERITY_LABELS[sev]} Findings</div>`);
    for (const f of group) {
      items.push(`<li class="finding">${sevDot(sev)}<span class="num">${escapeHtml(shortId(f.id))}</span><span class="title">${escapeHtml(f.title)}</span></li>`);
    }
  }

  return `
    <div class="toc-page">
      <span class="eyebrow">Table of Contents</span>
      <h1 class="section-title">Contents.</h1>
      <ul class="toc-list">${items.join('\n')}</ul>
    </div>`;
}

// ── Executive Summary ────────────────────────────────────────────────
function renderSummary(findings, scope, audit) {
  const bySev = {};
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

  const totalLoc = scope?.total_loc || scope?.files?.reduce((s, f) => s + f.loc, 0) || 0;
  const fileCount = scope?.files?.length || 0;
  const critHigh = (bySev.critical || 0) + (bySev.high || 0);
  const locDisplay = totalLoc >= 1000 ? (totalLoc / 1000).toFixed(1) + 'k' : String(totalLoc);
  const target = audit?.repoUrl || audit?.localPath || 'N/A';
  const framework = scope?.framework || 'anchor';

  const maxCount = Math.max(...SEVERITY_ORDER.map(s => bySev[s] || 0), 1);
  const distRows = SEVERITY_ORDER.filter(s => bySev[s]).map(s => {
    const pct = ((bySev[s] || 0) / maxCount) * 100;
    return `<div class="dist-row">
      <span class="name">${SEVERITY_LABELS[s]}</span>
      <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${T.sev[s].bg}"></div></div>
      <span class="count">${bySev[s]}</span>
    </div>`;
  }).join('');

  return `
    <div class="section" data-section="EXECUTIVE SUMMARY">
      <span class="eyebrow">Executive Summary</span>
      <h1 class="section-title">Overview.</h1>
      <div class="stats-grid">
        <div class="stat"><div class="key">FINDINGS</div><div class="val">${findings.length}</div><div class="sub">total identified</div></div>
        <div class="stat"><div class="key">CRITICAL + HIGH</div><div class="val">${critHigh}</div><div class="sub">priority remediation</div></div>
        <div class="stat"><div class="key">FILES ANALYZED</div><div class="val">${fileCount}</div><div class="sub">${escapeHtml(framework)} program</div></div>
        <div class="stat"><div class="key">LOC ANALYZED</div><div class="val">${locDisplay}</div><div class="sub">lines of code</div></div>
      </div>
      <h2 class="section-heading">Severity distribution</h2>
      ${distRows}
      <h2 class="section-heading">Scope</h2>
      <p>This audit covers the ${escapeHtml(framework)} program at <code>${escapeHtml(target)}</code>,
      comprising ${fileCount} source files and ${totalLoc.toLocaleString()} lines of code.</p>
      <h2 class="section-heading">Methodology</h2>
      <p>This report was generated using Daybreak&rsquo;s automated multi-agent security
      analysis pipeline. Five specialized agents analyze the codebase in parallel,
      covering access control, CPI &amp; token operations, arithmetic &amp; economic
      logic, state lifecycle, and invariant &amp; logic correctness. Findings are
      cross-validated and deduplicated before final output.</p>
    </div>`;
}

// ── Threat Model ─────────────────────────────────────────────────────
function renderThreatModel(tm) {
  if (!tm) return '';
  const parts = [];

  parts.push('<div class="section" data-section="THREAT MODEL">');
  parts.push('<span class="eyebrow">Threat Model</span>');
  parts.push('<h1 class="section-title">Threat model.</h1>');

  if (tm.executiveSummary) {
    parts.push(`<div class="tm-summary">${renderMarkdown(tm.executiveSummary)}</div>`);
  }

  const ps = tm.programSummary;
  if (ps) {
    parts.push('<h2 class="section-heading">Program overview</h2>');
    parts.push(`<table class="tm-table"><tbody>
      <tr><td class="key">Name</td><td class="label">${escapeHtml(ps.name || 'N/A')}</td></tr>
      <tr><td class="key">Framework</td><td>${escapeHtml(ps.framework || 'N/A')}</td></tr>
      <tr><td class="key">Lines of Code</td><td>${ps.totalLoc || 'N/A'}</td></tr>
      <tr><td class="key">Instructions</td><td>${ps.instructionCount || 0}</td></tr>
      <tr><td class="key">Handles Funds</td><td>${ps.handlesFunds ? 'Yes' : 'No'}</td></tr>
      <tr><td class="key">Uses Oracles</td><td>${ps.usesOracles ? 'Yes' : 'No'}</td></tr>
      <tr><td class="key">Complexity</td><td>${escapeHtml(ps.complexityProfile || 'N/A')}</td></tr>
    </tbody></table>`);
  }

  if (tm.actors && tm.actors.length > 0) {
    const trustCls = (level) => {
      const l = (level || '').toLowerCase();
      if (l.includes('untrust')) return 'untrusted';
      if (l.includes('semi')) return 'semi';
      return 'trusted';
    };
    parts.push('<h2 class="section-heading">Actors</h2>');
    parts.push(`<table class="tm-table">
      <thead><tr><th>Actor</th><th>Trust Level</th><th>Description</th></tr></thead>
      <tbody>${tm.actors.map(a => `<tr>
        <td class="label">${escapeHtml(a.label)}</td>
        <td><span class="trust-tag ${trustCls(a.trustLevel)}">${escapeHtml(a.trustLevel)}</span></td>
        <td>${escapeHtml(a.description)}</td>
      </tr>`).join('')}</tbody></table>`);
  }

  if (tm.trustBoundaries && tm.trustBoundaries.length > 0) {
    parts.push('<h2 class="section-heading">Trust boundaries</h2>');
    for (const tb of tm.trustBoundaries) {
      parts.push(`<div class="invariant-group">
        <div class="group-name">${escapeHtml(tb.name)} &mdash; ${escapeHtml(tb.riskLevel)}</div>
        <p>${escapeHtml(tb.description)}</p>
        ${tb.crossedBy?.length ? `<p class="meta" style="margin-top:6pt">Crossed by: ${tb.crossedBy.map(escapeHtml).join(', ')}</p>` : ''}
      </div>`);
    }
  }

  if (tm.invariants && tm.invariants.length > 0) {
    const TYPE_LABELS = { funds: 'Fund Conservation', access: 'Access Separation', state: 'State Consistency' };
    const grouped = {};
    for (const inv of tm.invariants) {
      if (!grouped[inv.type]) grouped[inv.type] = [];
      grouped[inv.type].push(inv);
    }
    parts.push('<h2 class="section-heading">Invariants</h2>');
    for (const type of ['funds', 'access', 'state']) {
      if (!grouped[type]) continue;
      parts.push(`<div class="invariant-group">
        <div class="group-name">${TYPE_LABELS[type] || type}</div>
        <ul>${grouped[type].map(inv =>
          `<li><strong>${escapeHtml(inv.id)}</strong> [${escapeHtml(inv.importance)}]: ${escapeHtml(inv.property)}<br><span class="meta">Scope: ${escapeHtml(inv.scope)}</span></li>`
        ).join('')}</ul>
      </div>`);
    }
  }

  if (tm.attackSurfaces && tm.attackSurfaces.length > 0) {
    parts.push('<h2 class="section-heading">Attack surfaces</h2>');
    for (const as of tm.attackSurfaces) {
      parts.push(`<div class="invariant-group">
        <div class="group-name">${escapeHtml(as.name)} &mdash; ${escapeHtml(as.threatLevel)}</div>
        <p>${escapeHtml(as.description)}</p>
        ${as.instructions?.length ? `<p class="meta" style="margin-top:4pt">Instructions: ${as.instructions.map(escapeHtml).join(', ')}</p>` : ''}
        ${as.exposureFactors?.length ? `<ul>${as.exposureFactors.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
      </div>`);
    }
  }

  if (tm.threatCategories && tm.threatCategories.length > 0) {
    parts.push('<h2 class="section-heading">Threat categories</h2>');
    for (const cat of tm.threatCategories) {
      const label = cat.category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      parts.push(`<div class="invariant-group">
        <div class="group-name">${escapeHtml(label)} &mdash; ${escapeHtml(cat.relevance)} relevance</div>
        <p>${escapeHtml(cat.summary)}</p>
        ${cat.affectedInstructions?.length ? `<p class="meta" style="margin-top:4pt">Affected: ${cat.affectedInstructions.map(escapeHtml).join(', ')}</p>` : ''}
      </div>`);
    }
  }

  parts.push('</div>');
  return parts.join('\n');
}

// ── Findings ─────────────────────────────────────────────────────────
function renderFindings(findings) {
  const bySev = {};
  for (const f of findings) {
    if (!bySev[f.severity]) bySev[f.severity] = [];
    bySev[f.severity].push(f);
  }

  const sections = [];
  for (const sev of SEVERITY_ORDER) {
    const group = bySev[sev];
    if (!group || group.length === 0) continue;

    // Findings flow continuously — each card has its own severity badge
    sections.push(`<div class="findings-group">`);

    for (const f of group) {
      const fileName = (f.file || '').split('/').pop() || f.file || '';
      sections.push(`<div class="finding">
        <div class="finding-head">
          ${sevBadge(f.severity)}
          <span class="finding-id">${escapeHtml(shortId(f.id))}</span>
        </div>
        <div class="finding-title">${escapeHtml(f.title)}</div>
        <div class="finding-meta">
          <div class="meta-line"><span class="meta-key">file</span> <span class="meta-val">${escapeHtml(fileName)}${f.line ? ':' + f.line : ''}</span></div>
          <div class="meta-line"><span class="meta-key">class</span> <span class="meta-val">${escapeHtml(f.bugClass || 'N/A')}</span><span class="meta-sep">&mdash;</span><span class="meta-key">confidence</span> <span class="meta-val">${escapeHtml(f.confidence || 'medium')}</span></div>
        </div>
        <div class="finding-section">
          <div class="finding-section-title">DESCRIPTION</div>
          <div class="finding-body">${renderMarkdown(f.description)}</div>
        </div>
        ${f.proof ? `<div class="finding-section">
          <div class="finding-section-title">PROOF</div>
          <div class="finding-body">${renderMarkdown(f.proof)}</div>
        </div>` : ''}
        ${f.recommendation ? `<div class="finding-section">
          <div class="finding-section-title">RECOMMENDATION</div>
          <div class="finding-body">${renderMarkdown(f.recommendation)}</div>
        </div>` : ''}
      </div>`);
    }
    sections.push('</div>');
  }
  return sections.join('\n');
}

// ── CSS ──────────────────────────────────────────────────────────────
function getCSS() {
  return `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400;1,9..144,500&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: letter; margin: 1.2in 0.75in 0.8in 0.75in; background: ${T.bgPage}; }
html { background: ${T.bgPage}; }

html, body {
  background: ${T.bgPage};
  color: ${T.textSecondary};
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 9.5pt;
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
p { margin-bottom: 8pt; }
p:last-child { margin-bottom: 0; }
strong { color: ${T.textPrimary}; font-weight: 500; }

/* ── Typography ───────────────────────────────── */
h1.section-title {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 28pt;
  color: ${T.textPrimary};
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin-bottom: 18pt;
}
h2.section-heading {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 18pt;
  color: ${T.textPrimary};
  margin-top: 22pt;
  margin-bottom: 10pt;
  line-height: 1.15;
}
.eyebrow {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.dawnCoral};
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 10pt;
  display: block;
}
.eyebrow::before {
  content: "\\25CF";
  display: inline-block;
  margin-right: 8pt;
  color: ${T.dawnCoral};
  font-size: 7pt;
  vertical-align: 2pt;
}
code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5pt;
  color: ${T.dawnGold};
  background: rgba(245, 215, 142, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
}
.meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textTertiary};
  letter-spacing: 0.08em;
}

/* ── Cover ────────────────────────────────────── */
.cover {
  min-height: 8.5in;
  padding: 0.35in 0;
  position: relative;
  page-break-after: always;
  overflow: hidden;
}
.cover::before {
  content: "";
  position: absolute;
  top: -4in;
  right: -4in;
  width: 8in;
  height: 8in;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 70%,
    rgba(232,90,140,0.18) 0%,
    rgba(237,127,101,0.12) 35%,
    rgba(245,166,91,0.06) 60%,
    transparent 75%);
}
.cover-brand {
  display: flex;
  align-items: baseline;
  gap: 8pt;
  margin-bottom: 1.4in;
  position: relative;
}
.cover-brand .name {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 14pt;
  color: ${T.dawnCoral};
}
.cover-brand .suffix {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9pt;
  color: ${T.textTertiary};
  letter-spacing: 0.12em;
}
.cover-eyebrow {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.dawnCoral};
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 18pt;
  position: relative;
}
.cover-eyebrow::before { content: "\\25CF"; margin-right: 10pt; font-size: 7pt; }
.cover-title {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 32pt;
  color: ${T.textPrimary};
  line-height: 1.05;
  letter-spacing: -0.015em;
  margin-bottom: 6pt;
  position: relative;
}
.cover-subject {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-size: 22pt;
  color: ${T.dawnCoral};
  margin-bottom: 36pt;
  line-height: 1.1;
  position: relative;
}
.cover-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12pt;
  margin-top: 36pt;
  padding-top: 18pt;
  border-top: 0.5pt solid ${T.borderDefault};
  position: relative;
}
.cover-meta .item .key {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.textTertiary};
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin-bottom: 4pt;
  display: block;
}
.cover-meta .item .val {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-size: 14pt;
  color: ${T.textPrimary};
}
.cover-severity { margin-top: 0.45in; position: relative; }
.cover-severity .label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.dawnCoral};
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 10pt;
}
.cover-severity .label::before { content: "\\25CF"; margin-right: 8pt; font-size: 7pt; }
.severity-bar {
  display: flex;
  height: 8pt;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12pt;
  background: ${T.borderSubtle};
}
.seg-critical { background: #DC2626; }
.seg-high     { background: #F08D4A; }
.seg-medium   { background: #E8C26B; }
.seg-low      { background: #7A92C4; }
.seg-informational { background: #8B95A8; }
.severity-pills { display: flex; gap: 8pt; flex-wrap: wrap; }
.sev-pill {
  display: inline-flex;
  align-items: center;
  gap: 6pt;
  padding: 4pt 9pt;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sev-pill .dot { width: 6pt; height: 6pt; border-radius: 50%; display: inline-block; }
.sev-pill .count { font-weight: bold; }
.sev-pill.critical { background: rgba(220,38,38,0.14); color: ${T.textPrimary}; }
.sev-pill.critical .dot { background: #DC2626; }
.sev-pill.high     { background: rgba(240,141,74,0.14); color: ${T.textPrimary}; }
.sev-pill.high .dot     { background: #F08D4A; }
.sev-pill.medium   { background: rgba(232,194,107,0.14); color: ${T.textPrimary}; }
.sev-pill.medium .dot   { background: #E8C26B; }
.sev-pill.low      { background: rgba(122,146,196,0.14); color: ${T.textPrimary}; }
.sev-pill.low .dot      { background: #7A92C4; }
.sev-pill.info     { background: rgba(139,149,168,0.14); color: ${T.textPrimary}; }
.sev-pill.info .dot     { background: #8B95A8; }
.cover-footer {
  position: absolute;
  bottom: 0.15in;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-top: 12pt;
  border-top: 0.5pt solid;
  border-image: linear-gradient(90deg, #E85A8C, #F5A65B, #F5D78E) 1;
}
.cover-footer .left {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-size: 11pt;
  color: ${T.textPrimary};
}
.cover-footer .right {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textTertiary};
  letter-spacing: 0.10em;
  text-transform: uppercase;
}

/* ── TOC ──────────────────────────────────────── */
.toc-page { page-break-after: always; padding: 0.35in 0; }
.toc-list { list-style: none; }
.toc-list li {
  display: flex;
  align-items: baseline;
  gap: 8pt;
  padding: 5pt 0;
  border-bottom: 0.5pt dotted ${T.borderDefault};
  font-size: 10pt;
}
.toc-list .num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textTertiary};
  width: 32pt;
  flex-shrink: 0;
}
.toc-list .title {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  color: ${T.textPrimary};
  flex: 1;
}
.toc-list li.finding {
  padding-left: 28pt;
  border-bottom: none;
  font-size: 9pt;
}
.toc-list li.finding .title { color: ${T.textSecondary}; font-style: italic; }
.toc-list li.finding .num { font-size: 7.5pt; width: 64pt; text-transform: uppercase; }
.toc-group-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.dawnCoral};
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: 14pt 0 6pt 28pt;
}

/* ── Sections ─────────────────────────────────── */
.section { page-break-before: always; padding: 0.35in 0 0; }
.tm-summary { margin-bottom: 16pt; }
.tm-summary p { line-height: 1.55; }

/* ── Stats grid ───────────────────────────────── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10pt;
  margin: 14pt 0 20pt;
}
.stat {
  background: ${T.bgPanel};
  border: 0.5pt solid ${T.borderSubtle};
  border-radius: 6px;
  padding: 12pt;
}
.stat .key {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.textTertiary};
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin-bottom: 6pt;
}
.stat .val {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 24pt;
  color: ${T.textPrimary};
  line-height: 1;
}
.stat .sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.textTertiary};
  margin-top: 4pt;
}
.dist-row { display: flex; align-items: center; gap: 12pt; margin: 5pt 0; }
.dist-row .name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textSecondary};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  width: 90pt;
}
.dist-row .bar-wrap {
  flex: 1;
  height: 6pt;
  background: ${T.borderSubtle};
  border-radius: 3px;
  overflow: hidden;
}
.dist-row .bar { height: 100%; border-radius: 3px; }
.dist-row .count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textPrimary};
  width: 24pt;
  text-align: right;
}

/* ── Threat model ─────────────────────────────── */
table.tm-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8pt 0 16pt;
  font-size: 9pt;
}
table.tm-table th {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.textTertiary};
  letter-spacing: 0.10em;
  text-transform: uppercase;
  text-align: left;
  font-weight: 400;
  padding: 8pt 10pt;
  border-bottom: 0.5pt solid ${T.borderStrong};
}
table.tm-table td {
  color: ${T.textSecondary};
  padding: 8pt 10pt;
  border-bottom: 0.5pt solid ${T.borderSubtle};
  vertical-align: top;
}
table.tm-table td.key {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5pt;
  color: ${T.dawnGold};
}
table.tm-table td.label {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  color: ${T.textPrimary};
}
.trust-tag {
  display: inline-block;
  padding: 2pt 7pt;
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.trust-tag.untrusted { background: rgba(220,38,38,0.14); color: ${T.textPrimary}; }
.trust-tag.semi      { background: rgba(232,194,107,0.14); color: ${T.textPrimary}; }
.trust-tag.trusted   { background: rgba(122,146,196,0.14); color: ${T.textPrimary}; }
.invariant-group {
  background: ${T.bgPanel};
  border: 0.5pt solid ${T.borderSubtle};
  border-radius: 6px;
  padding: 12pt 14pt;
  margin-bottom: 10pt;
}
.invariant-group .group-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.dawnCoral};
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin-bottom: 8pt;
}
.invariant-group ul { list-style: none; padding: 0; }
.invariant-group li {
  font-size: 9pt;
  color: ${T.textSecondary};
  padding: 3pt 0 3pt 14pt;
  position: relative;
  line-height: 1.45;
}
.invariant-group li::before {
  content: "\\2192";
  position: absolute;
  left: 0;
  color: ${T.dawnAmber};
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
}
.invariant-group p { font-size: 9pt; color: ${T.textSecondary}; line-height: 1.45; }

/* ── Findings ─────────────────────────────────── */
.findings-group:first-of-type { page-break-before: always; padding-top: 0.35in; }
.finding {
  padding: 14pt 0 18pt;
  border-bottom: 0.5pt solid;
  border-image: linear-gradient(90deg,
    rgba(232,90,140,0.4), rgba(245,166,91,0.4),
    rgba(245,215,142,0.4), transparent 70%) 1;
  page-break-inside: avoid;
}
.finding:first-of-type { padding-top: 6pt; }
.finding-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8pt;
  page-break-after: avoid;
}
.sev-badge {
  display: inline-flex;
  align-items: center;
  padding: 4pt 10pt;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: bold;
}
.sev-dot {
  display: inline-block;
  width: 6pt;
  height: 6pt;
  border-radius: 50%;
  margin-right: 6pt;
}
.finding-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9pt;
  color: ${T.textTertiary};
  letter-spacing: 0.10em;
  text-transform: uppercase;
}
.finding-title {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 18pt;
  color: ${T.textPrimary};
  line-height: 1.15;
  margin-bottom: 8pt;
}
.finding-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.textTertiary};
  letter-spacing: 0.06em;
  margin-bottom: 14pt;
  padding-bottom: 10pt;
  border-bottom: 0.5pt solid ${T.borderSubtle};
}
.finding-meta .meta-line { margin-bottom: 2pt; }
.finding-meta .meta-sep { color: ${T.borderStrong}; margin: 0 8pt; }
.finding-meta .meta-val { color: ${T.dawnGold}; }
.finding-section { margin-top: 12pt; }
.finding-section-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.dawnCoral};
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 6pt;
}
.finding-body p { color: ${T.textSecondary}; line-height: 1.55; }
.finding-body ul, .finding-body ol {
  padding-left: 18pt;
  margin-bottom: 8pt;
  color: ${T.textSecondary};
}
.finding-body li { margin-bottom: 3pt; line-height: 1.55; }

/* ── Code blocks ──────────────────────────────── */
.code-block {
  background: ${T.bgInset};
  border: 0.5pt solid ${T.borderSubtle};
  border-radius: 6px;
  margin: 8pt 0;
  overflow: hidden;
  page-break-inside: avoid;
}
.code-block .file-bar {
  background: rgba(245,239,230,0.04);
  border-bottom: 0.5pt solid ${T.borderSubtle};
  padding: 5pt 10pt;
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5pt;
  color: ${T.textTertiary};
  letter-spacing: 0.06em;
}
.code-block .file-bar .path { color: ${T.dawnGold}; }
.code-block .body {
  padding: 8pt 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textSecondary};
  line-height: 1.5;
}
.code-block .body .ln {
  display: block;
  padding-left: 36pt;
  position: relative;
  white-space: pre-wrap;
  word-break: break-all;
}
.code-block .body .ln::before {
  content: attr(data-ln);
  position: absolute;
  left: 8pt;
  width: 22pt;
  text-align: right;
  color: ${T.textTertiary};
  font-size: 7.5pt;
}
.code-block .body .ln.hl { background: rgba(220,38,38,0.10); }
.code-block .body .ln.hl::before { color: #F08D4A; }

/* ── Callouts ────────────────────────────────── */
p.callout {
  border-left: 2pt solid ${T.dawnCoral};
  padding: 8pt 12pt;
  background: rgba(237,127,101,0.04);
  border-radius: 0 4px 4px 0;
  margin-bottom: 8pt;
}

/* ── Back page ────────────────────────────────── */
.back-page {
  page-break-before: always;
  min-height: 8in;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 2in 0;
}
.back-page .brand {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 18pt;
  color: ${T.dawnCoral};
  margin-bottom: 4pt;
}
.back-page .url {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9pt;
  color: ${T.textTertiary};
  letter-spacing: 0.08em;
}
.back-page .gradient-rule {
  width: 180pt;
  height: 0.5pt;
  margin: 16pt auto;
  background: linear-gradient(90deg, ${T.dawnMagenta}, ${T.dawnAmber}, ${T.dawnGold});
  border-radius: 1px;
}
.back-page .disclaimer {
  max-width: 360pt;
  margin-top: 32pt;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 8pt;
  color: ${T.textTertiary};
  line-height: 1.6;
}
.back-page .disclaimer p { margin-bottom: 6pt; }
.back-page .contact {
  margin-top: 20pt;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8pt;
  color: ${T.textTertiary};
  letter-spacing: 0.08em;
}
`;
}

// ── Full HTML document ───────────────────────────────────────────────
function buildHtml(audit, findings, scope, threatModel) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>${getCSS()}</style>
</head>
<body>
  ${renderCover(audit, findings, scope)}
  ${renderTOC(findings, !!threatModel)}
  ${renderSummary(findings, scope, audit)}
  ${threatModel ? renderThreatModel(threatModel) : ''}
  ${renderFindings(findings)}
  <div class="back-page">
    <div class="brand">Daybreak</div>
    <div class="gradient-rule"></div>
    <div class="url">daybreaksec.com</div>
    <div class="disclaimer">
      <p>This report was generated using automated security analysis tooling.
      It does not constitute a formal security audit, investment advice, or
      guarantee of code correctness. Findings represent potential issues
      identified through static analysis and may include false positives.</p>
      <p>A comprehensive manual audit by experienced security researchers is
      recommended before deploying to mainnet or handling user funds.</p>
    </div>
    <div class="contact">colin@daybreaksec.com</div>
  </div>
</body>
</html>`;
}

/**
 * Generate a PDF buffer from audit data.
 */
async function generatePdf({ audit, findings, scope, threatModel }) {
  const html = buildHtml(audit, findings, scope, threatModel);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdf = await page.pdf({
      width: '8.5in',
      height: '11in',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width:100%;padding:0 0.75in;display:flex;justify-content:space-between;align-items:baseline;font-size:8pt;">
          <span><span style="font-style:italic;font-size:10pt;color:#ED7F65;font-family:Georgia,serif;">Daybreak</span> <span style="font-family:monospace;font-size:7pt;color:#8892AB;letter-spacing:0.12em;text-transform:uppercase;">SECURITY</span></span>
          <span style="font-family:monospace;font-size:7pt;color:#8892AB;letter-spacing:0.10em;text-transform:uppercase;">SECURITY AUDIT REPORT</span>
        </div>`,
      footerTemplate: `
        <div style="width:100%;padding:0 0.75in;">
          <div style="height:1px;background:linear-gradient(90deg,#E85A8C,#F5A65B,#F5D78E);margin-bottom:6pt;"></div>
          <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:7pt;color:#8892AB;">
            <span>Daybreak &middot; daybreaksec.com</span>
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>
        </div>`,
      margin: {
        top: '1.2in',
        bottom: '0.8in',
        left: '0.75in',
        right: '0.75in',
      },
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generatePdf, buildHtml };
