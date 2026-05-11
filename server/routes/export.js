const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isValidFindingId } = require('../lib/path-validator');
const { readFindings, getStateDir, readJSON } = require('../lib/state-io');
const { generatePdf } = require('../lib/pdf-report');
const router = express.Router();

function severityLabel(s) {
  const labels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', informational: 'Info' };
  return labels[s] || s;
}

function severityEmoji(s) {
  const emojis = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', informational: '⚪' };
  return emojis[s] || '⚪';
}

// POST /api/export/github-issues - create GitHub issues via gh CLI
router.post('/github-issues', (req, res) => {
  try {
    const { repo, findingIds } = req.body;
    if (!repo || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      return res.status(400).json({ error: 'repo must be in owner/name format (alphanumeric, hyphens, dots, underscores only)' });
    }

    if (findingIds !== undefined) {
      if (!Array.isArray(findingIds) || !findingIds.every(id => isValidFindingId(id))) {
        return res.status(400).json({ error: 'findingIds must be an array of valid finding IDs' });
      }
    }

    const data = readFindings();
    const findings = findingIds
      ? data.findings.filter(f => findingIds.includes(f.id))
      : data.findings.filter(f => f.status === 'valid');

    if (findings.length === 0) {
      return res.status(400).json({ error: 'No findings to export' });
    }

    const created = [];
    for (const finding of findings) {
      const title = `[${severityLabel(finding.severity)}] ${finding.title}`;
      const body = [
        `## ${finding.title}`,
        '',
        `**Severity**: ${severityEmoji(finding.severity)} ${severityLabel(finding.severity)}`,
        `**Bug Class**: ${finding.bugClass}`,
        `**File**: ${finding.file}:${finding.line}`,
        `**Agent**: ${finding.agent}`,
        '',
        '### Description',
        finding.description,
        '',
        '### Proof',
        finding.proof,
        '',
        '### Recommendation',
        finding.recommendation,
        '',
        '---',
        '*Found by [Daybreak Solana](https://github.com/DaybreakSec/daybreak-solana)*',
      ].join('\n');

      const labels = `security,${finding.severity}`;

      try {
        const result = execFileSync('gh', [
          'issue', 'create',
          '--repo', repo,
          '--title', title,
          '--body', body,
          '--label', labels,
        ], { encoding: 'utf8', timeout: 30000 });
        const issueUrl = result.trim();
        created.push({ findingId: finding.id, issueUrl });
      } catch (ghErr) {
        created.push({ findingId: finding.id, error: ghErr.message });
      }
    }

    res.json({ created });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export GitHub issues' });
  }
});

// POST /api/export/threat-model - export threat model as markdown
router.post('/threat-model', (req, res) => {
  try {
    const stateDir = getStateDir();
    const tmPath = path.join(stateDir, 'threat-model.json');

    if (!fs.existsSync(tmPath)) {
      return res.status(404).json({ error: 'Threat model not available' });
    }

    const tm = JSON.parse(fs.readFileSync(tmPath, 'utf8'));
    const report = renderThreatModelMarkdown(tm);
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export threat model' });
  }
});

// POST /api/export/report - generate markdown report
router.post('/report', (req, res) => {
  try {
    const { findingIds, template, includeThreatModel } = req.body;

    if (findingIds !== undefined) {
      if (!Array.isArray(findingIds) || !findingIds.every(id => isValidFindingId(id))) {
        return res.status(400).json({ error: 'findingIds must be an array of valid finding IDs' });
      }
    }

    const data = readFindings();
    const findings = findingIds
      ? data.findings.filter(f => findingIds.includes(f.id))
      : data.findings.filter(f => f.status === 'valid');

    // Read audit metadata
    const stateDir = getStateDir();
    let audit = {};
    const auditPath = path.join(stateDir, 'audit.json');
    if (fs.existsSync(auditPath)) {
      audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    }

    // Group by severity
    const bySeverity = {};
    for (const f of findings) {
      if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
      bySeverity[f.severity].push(f);
    }

    const severityOrder = ['critical', 'high', 'medium', 'low', 'informational'];

    // Optionally prepend threat model
    let threatModelSection = '';
    if (includeThreatModel) {
      const tmPath = path.join(stateDir, 'threat-model.json');
      if (fs.existsSync(tmPath)) {
        try {
          const tm = JSON.parse(fs.readFileSync(tmPath, 'utf8'));
          threatModelSection = renderThreatModelMarkdown(tm) + '\n\n---\n\n';
        } catch {}
      }
    }

    let report = [
      '# Security Audit Report',
      '',
      `**Target**: ${audit.repoUrl || audit.localPath || 'N/A'}`,
      `**Date**: ${new Date().toISOString().split('T')[0]}`,
      `**Findings**: ${findings.length}`,
      `**Tool**: [Daybreak Solana](https://github.com/DaybreakSec/daybreak-solana)`,
      '',
      '## Summary',
      '',
      '| Severity | Count |',
      '|----------|-------|',
    ];

    for (const sev of severityOrder) {
      const count = (bySeverity[sev] || []).length;
      if (count > 0) {
        report.push(`| ${severityEmoji(sev)} ${severityLabel(sev)} | ${count} |`);
      }
    }

    report.push('', '---', '');

    // Findings by severity
    for (const sev of severityOrder) {
      const group = bySeverity[sev];
      if (!group || group.length === 0) continue;

      report.push(`## ${severityEmoji(sev)} ${severityLabel(sev)} Findings`, '');

      for (const f of group) {
        report.push(
          `### ${f.id}: ${f.title}`,
          '',
          `**File**: \`${f.file}:${f.line}\``,
          `**Bug Class**: ${f.bugClass}`,
          '',
          '#### Description',
          f.description,
          '',
          '#### Proof',
          f.proof,
          '',
          '#### Recommendation',
          f.recommendation,
          '',
          '---',
          ''
        );
      }
    }

    // Append Daybreak footer
    report.push(
      '---',
      '',
      '*Generated by [Daybreak Solana](https://github.com/DaybreakSec/daybreak-solana) — open-source security audit tooling by [Daybreak](https://daybreaksec.com)*',
    );

    res.json({ report: threatModelSection + report.join('\n') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// POST /api/export/json - export raw findings as JSON
router.post('/json', (req, res) => {
  try {
    const { findingIds } = req.body;

    if (findingIds !== undefined) {
      if (!Array.isArray(findingIds) || !findingIds.every(id => isValidFindingId(id))) {
        return res.status(400).json({ error: 'findingIds must be an array of valid finding IDs' });
      }
    }

    const data = readFindings();
    const findings = findingIds
      ? data.findings.filter(f => findingIds.includes(f.id))
      : data.findings.filter(f => f.status === 'valid');

    res.json({ findings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export findings' });
  }
});

// POST /api/export/pdf - generate a styled PDF audit report
router.post('/pdf', async (req, res) => {
  try {
    const { findingIds, includeThreatModel } = req.body;

    if (findingIds !== undefined) {
      if (!Array.isArray(findingIds) || !findingIds.every(id => isValidFindingId(id))) {
        return res.status(400).json({ error: 'findingIds must be an array of valid finding IDs' });
      }
    }

    const data = readFindings();
    const findings = findingIds
      ? data.findings.filter(f => findingIds.includes(f.id))
      : data.findings.filter(f => f.status === 'valid');

    if (findings.length === 0) {
      return res.status(400).json({ error: 'No findings to export' });
    }

    // Read audit + scope metadata
    const stateDir = getStateDir();
    let audit = {};
    const auditPath = path.join(stateDir, 'audit.json');
    if (fs.existsSync(auditPath)) {
      audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    }

    const scope = readJSON('scope.json') || {};

    let threatModel = null;
    if (includeThreatModel) {
      const tmPath = path.join(stateDir, 'threat-model.json');
      if (fs.existsSync(tmPath)) {
        try { threatModel = JSON.parse(fs.readFileSync(tmPath, 'utf8')); } catch {}
      }
    }

    const pdfBuffer = await generatePdf({ audit, findings, scope, threatModel });

    const name = audit.repoUrl
      ? audit.repoUrl.split('/').pop().replace('.git', '')
      : audit.localPath
        ? audit.localPath.split('/').pop()
        : 'audit';
    const date = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="daybreak-${name}-${date}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'Failed to generate PDF: ' + err.message });
  }
});

/**
 * Render a threat model JSON object as structured markdown.
 */
function renderThreatModelMarkdown(tm) {
  const lines = [];

  lines.push('# Threat Model');
  lines.push('');

  // Executive Summary
  if (tm.executiveSummary) {
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(tm.executiveSummary);
    lines.push('');
  }

  // Program Summary
  const ps = tm.programSummary;
  if (ps) {
    lines.push('## Program Overview');
    lines.push('');
    lines.push(`| Property | Value |`);
    lines.push(`|----------|-------|`);
    lines.push(`| Name | ${ps.name || 'N/A'} |`);
    lines.push(`| Framework | ${ps.framework || 'N/A'} |`);
    lines.push(`| Lines of Code | ${ps.totalLoc || 'N/A'} |`);
    lines.push(`| Instructions | ${ps.instructionCount || 0} |`);
    lines.push(`| Handles Funds | ${ps.handlesFunds ? 'Yes' : 'No'} |`);
    lines.push(`| Uses Oracles | ${ps.usesOracles ? 'Yes' : 'No'} |`);
    lines.push(`| Complexity | ${ps.complexityProfile || 'N/A'} |`);
    lines.push('');
  }

  // Actors
  if (tm.actors && tm.actors.length > 0) {
    lines.push('## Actors');
    lines.push('');
    lines.push('| Actor | Trust Level | Instructions | Description |');
    lines.push('|-------|------------|--------------|-------------|');
    for (const a of tm.actors) {
      const ixList = (a.instructions || []).join(', ');
      lines.push(`| ${a.label} | ${a.trustLevel} | ${ixList} | ${a.description} |`);
    }
    lines.push('');
  }

  // Trust Boundaries
  if (tm.trustBoundaries && tm.trustBoundaries.length > 0) {
    lines.push('## Trust Boundaries');
    lines.push('');
    for (const tb of tm.trustBoundaries) {
      lines.push(`### ${tb.name} (${tb.riskLevel})`);
      lines.push('');
      lines.push(tb.description);
      lines.push('');
      if (tb.crossedBy && tb.crossedBy.length > 0) {
        lines.push(`**Crossed by**: ${tb.crossedBy.join(', ')}`);
        lines.push('');
      }
    }
  }

  // Invariants
  if (tm.invariants && tm.invariants.length > 0) {
    lines.push('## Invariants');
    lines.push('');
    const TYPE_LABELS = { funds: 'Fund Conservation', access: 'Access Separation', state: 'State Consistency' };
    const grouped = {};
    for (const inv of tm.invariants) {
      if (!grouped[inv.type]) grouped[inv.type] = [];
      grouped[inv.type].push(inv);
    }
    for (const type of ['funds', 'access', 'state']) {
      if (!grouped[type]) continue;
      lines.push(`### ${TYPE_LABELS[type] || type}`);
      lines.push('');
      for (const inv of grouped[type]) {
        lines.push(`- **${inv.id}** [${inv.importance}]: ${inv.property}`);
        lines.push(`  - Scope: ${inv.scope}`);
      }
      lines.push('');
    }
  }

  // Attack Surfaces
  if (tm.attackSurfaces && tm.attackSurfaces.length > 0) {
    lines.push('## Attack Surfaces');
    lines.push('');
    for (const as of tm.attackSurfaces) {
      lines.push(`### ${as.name} (${as.threatLevel})`);
      lines.push('');
      lines.push(as.description);
      lines.push('');
      if (as.instructions && as.instructions.length > 0) {
        lines.push(`**Instructions**: ${as.instructions.join(', ')}`);
      }
      if (as.exposureFactors && as.exposureFactors.length > 0) {
        lines.push('');
        lines.push('**Exposure factors**:');
        for (const f of as.exposureFactors) {
          lines.push(`- ${f}`);
        }
      }
      lines.push('');
    }
  }

  // Threat Categories
  if (tm.threatCategories && tm.threatCategories.length > 0) {
    lines.push('## Threat Categories');
    lines.push('');
    for (const cat of tm.threatCategories) {
      const label = cat.category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`### ${label} (${cat.relevance} relevance)`);
      lines.push('');
      lines.push(cat.summary);
      lines.push('');
      if (cat.affectedInstructions && cat.affectedInstructions.length > 0) {
        lines.push(`**Affected instructions**: ${cat.affectedInstructions.join(', ')}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

module.exports = router;
