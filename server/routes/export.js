const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isValidFindingId } = require('../lib/path-validator');
const router = express.Router();

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readFindings() {
  const stateDir = process.env.AUDIT_STATE_DIR || path.join(REPO_ROOT, 'state');
  const filepath = path.join(stateDir, 'findings.json');
  if (!fs.existsSync(filepath)) {
    return { findings: [] };
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

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
    const stateDir = process.env.AUDIT_STATE_DIR || path.join(REPO_ROOT, 'state');
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
    const stateDir = process.env.AUDIT_STATE_DIR || path.join(process.cwd(), 'state');
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
      if (as.attackVectors && as.attackVectors.length > 0) {
        lines.push('');
        lines.push('**Attack Vectors**:');
        for (const v of as.attackVectors) {
          lines.push(`- ${v}`);
        }
      }
      lines.push('');
    }
  }

  // Threat Categories
  if (tm.threatCategories && tm.threatCategories.length > 0) {
    lines.push('## Threat Analysis');
    lines.push('');
    for (const cat of tm.threatCategories) {
      const label = cat.category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`### ${label}`);
      lines.push('');
      if (cat.threats && cat.threats.length > 0) {
        lines.push('| ID | Threat | Likelihood | Impact | Instructions |');
        lines.push('|----|--------|-----------|--------|--------------|');
        for (const t of cat.threats) {
          const ixList = (t.affectedInstructions || []).join(', ');
          lines.push(`| ${t.id} | ${t.title} | ${t.likelihood} | ${t.impact} | ${ixList} |`);
        }
        lines.push('');
        for (const t of cat.threats) {
          lines.push(`**${t.id}: ${t.title}** - ${t.description}`);
          lines.push('');
        }
      }
    }
  }

  // Invariant Analysis
  if (tm.invariantThreats && tm.invariantThreats.length > 0) {
    lines.push('## Invariant Analysis');
    lines.push('');
    for (const inv of tm.invariantThreats) {
      lines.push(`### ${inv.invariant} (${inv.type})`);
      lines.push('');
      if (inv.threatenedBy && inv.threatenedBy.length > 0) {
        lines.push(`**Threatened by**: ${inv.threatenedBy.join(', ')}`);
      }
      if (inv.potentialViolations && inv.potentialViolations.length > 0) {
        lines.push('');
        lines.push('**Potential violations**:');
        for (const v of inv.potentialViolations) {
          lines.push(`- ${v}`);
        }
      }
      lines.push('');
    }
  }

  // Key Risks
  if (tm.keyRisks && tm.keyRisks.length > 0) {
    lines.push('## Key Risks');
    lines.push('');
    for (const r of tm.keyRisks) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }

  // Recommended Focus
  if (tm.recommendedFocus && tm.recommendedFocus.length > 0) {
    lines.push('## Recommended Focus Areas');
    lines.push('');
    for (const f of tm.recommendedFocus) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  // Attack Narratives
  if (tm.attackNarratives && tm.attackNarratives.length > 0) {
    lines.push('## Attack Narratives');
    lines.push('');
    for (const an of tm.attackNarratives) {
      lines.push(`### ${an.title} (${an.estimatedSeverity})`);
      lines.push('');
      lines.push(an.narrative);
      lines.push('');
      if (an.preconditions && an.preconditions.length > 0) {
        lines.push('**Preconditions**:');
        for (const p of an.preconditions) {
          lines.push(`- ${p}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

module.exports = router;
