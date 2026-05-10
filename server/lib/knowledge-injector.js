const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REFERENCES_DIR = path.join(REPO_ROOT, 'references');

// In-memory cache - read once per process
let _bugClassData = null;
let _heuristicSections = null;
let _attackSurfaceSections = null;
let _dismissedPatterns = null;

// Heuristic-to-agent mapping
const AGENT_HEURISTICS = {
  'accounts-access': ['H6', 'H8'],
  'cpi-token':       ['H4', 'H5'],
  'arithmetic-economic': ['H1', 'H2', 'H11'],
  'state-lifecycle': ['H3', 'H9', 'H10'],
  'invariant-logic':  ['H7'],
};

// Protocol type keywords detected from scout output
const PROTOCOL_KEYWORDS = {
  'Lending':                      ['lending', 'borrow', 'liquidat', 'obligation', 'collateral', 'lend'],
  'AMM / DLMM':                   ['swap', 'pool', 'liquidity', 'bin', 'amm', 'dlmm', 'concentrated'],
  'Vaults':                        ['vault', 'strategy', 'deposit', 'withdraw', 'rebalance'],
  'Perpetual Exchanges':           ['position', 'leverage', 'funding', 'perp', 'perpetual', 'liquidation'],
  'Limit Orders / Aggregators':    ['order', 'route', 'aggregat', 'limit', 'limo'],
};

// Section headers in audit-report-analysis.md for attack surface map
const ATTACK_SURFACE_HEADERS = {
  'Lending':                     '### Lending Protocols',
  'AMM / DLMM':                  '### AMM / DLMM',
  'Vaults':                      '### Vaults',
  'Perpetual Exchanges':         '### Perpetual Exchanges',
  'Limit Orders / Aggregators':  '### Limit Orders / Aggregators',
};

/**
 * Safely read a file, returning null if missing.
 */
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Knowledge injector: reference file not found: ${filePath}`);
      return null;
    }
    throw err;
  }
}

/**
 * Read and cache bug-class-ids.json.
 */
function loadBugClasses() {
  if (_bugClassData) return _bugClassData;
  const filePath = path.join(REFERENCES_DIR, 'bug-class-ids.json');
  const raw = safeReadFile(filePath);
  _bugClassData = raw ? JSON.parse(raw) : { classes: {} };
  return _bugClassData;
}

/**
 * Parse heuristic sections (H1-H11) from audit-report-analysis.md.
 * Returns a map of { 'H1': 'full section text', ... }
 */
function loadHeuristics() {
  if (_heuristicSections) return _heuristicSections;
  const filePath = path.join(REFERENCES_DIR, 'audit-report-analysis.md');
  const content = safeReadFile(filePath);
  if (!content) { _heuristicSections = {}; return _heuristicSections; }

  _heuristicSections = {};
  const heuristicRegex = /^### (H\d+):.+$/gm;
  const matches = [...content.matchAll(heuristicRegex)];

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1]; // e.g. 'H1'
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.indexOf('\n---\n', start);
    const section = content.slice(start, end === -1 ? undefined : end).trim();
    _heuristicSections[key] = section;
  }

  return _heuristicSections;
}

/**
 * Parse protocol attack surface sections from audit-report-analysis.md.
 * Returns a map of { 'Lending': 'section text', ... }
 */
function loadAttackSurfaces() {
  if (_attackSurfaceSections) return _attackSurfaceSections;
  const filePath = path.join(REFERENCES_DIR, 'audit-report-analysis.md');
  const content = safeReadFile(filePath);
  if (!content) { _attackSurfaceSections = {}; return _attackSurfaceSections; }

  _attackSurfaceSections = {};

  for (const [protocolType, header] of Object.entries(ATTACK_SURFACE_HEADERS)) {
    const start = content.indexOf(header);
    if (start === -1) continue;

    // Find the end: next ### header or --- section break, whichever comes first
    const searchFrom = start + header.length;
    const nextH3 = content.indexOf('\n### ', searchFrom);
    const sectionBreak = content.indexOf('\n---\n', searchFrom);

    let end = content.length;
    if (nextH3 !== -1) end = nextH3;
    if (sectionBreak !== -1 && sectionBreak < end) end = sectionBreak;

    _attackSurfaceSections[protocolType] = content.slice(start, end).trim();
  }

  return _attackSurfaceSections;
}

/**
 * Get canonical bug class IDs relevant to a specific agent.
 * Returns a formatted string listing bug classes for the agent's domain.
 */
function getBugClassesForAgent(agentKey) {
  const data = loadBugClasses();
  const classes = data.classes || {};
  const agentClasses = [];

  for (const [id, meta] of Object.entries(classes)) {
    if (meta.agent === agentKey) {
      agentClasses.push({ id, ref: meta.ref, domain: meta.domain });
    }
  }

  if (agentClasses.length === 0) return null;

  // Sort by ref number
  agentClasses.sort((a, b) => {
    const [aMaj, aMin] = a.ref.split('.').map(Number);
    const [bMaj, bMin] = b.ref.split('.').map(Number);
    return aMaj - bMaj || aMin - bMin;
  });

  const lines = agentClasses.map(c => `- ${c.ref}: \`${c.id}\``);
  return lines.join('\n');
}

/**
 * Get detection heuristic checklists relevant to a specific agent.
 * Returns the concatenated heuristic sections for the agent.
 */
function getHeuristicsForAgent(agentKey) {
  const mapping = AGENT_HEURISTICS[agentKey];
  if (!mapping || mapping.length === 0) return null;

  const heuristics = loadHeuristics();
  const sections = [];

  for (const key of mapping) {
    if (heuristics[key]) {
      sections.push(heuristics[key]);
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

/**
 * Detect protocol type from scout output and return matching attack surface map.
 * If no match, returns all attack surfaces as combined context.
 */
function getProtocolAttackSurface(scoutOutput) {
  if (!scoutOutput) return null;

  const surfaces = loadAttackSurfaces();
  if (Object.keys(surfaces).length === 0) return null;

  // Build a text blob from scout output to search for keywords
  const scoutText = JSON.stringify(scoutOutput).toLowerCase();

  const matchedTypes = [];
  for (const [protocolType, keywords] of Object.entries(PROTOCOL_KEYWORDS)) {
    if (keywords.some(kw => scoutText.includes(kw))) {
      matchedTypes.push(protocolType);
    }
  }

  if (matchedTypes.length === 0) {
    // No match - inject all surfaces
    return Object.values(surfaces).join('\n\n');
  }

  const matched = matchedTypes
    .filter(t => surfaces[t])
    .map(t => surfaces[t]);

  return matched.length > 0 ? matched.join('\n\n') : null;
}

/**
 * Get full dismissed patterns content for validation agent.
 */
function getDismissedPatterns() {
  if (_dismissedPatterns) return _dismissedPatterns;
  const filePath = path.join(REFERENCES_DIR, 'dismissed-patterns-solana.md');
  _dismissedPatterns = safeReadFile(filePath);
  return _dismissedPatterns;
}

/**
 * Get full bug class taxonomy JSON for synthesis agent.
 */
function getBugClassTaxonomy() {
  const data = loadBugClasses();
  if (!data.classes || Object.keys(data.classes).length === 0) return null;
  return JSON.stringify(data, null, 2);
}

module.exports = {
  getBugClassesForAgent,
  getHeuristicsForAgent,
  getProtocolAttackSurface,
  getDismissedPatterns,
  getBugClassTaxonomy,
};
