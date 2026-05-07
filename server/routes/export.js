const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const router = express.Router();

function readFindings() {
  const stateDir = process.env.AUDIT_STATE_DIR || path.join(process.cwd(), 'state');
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
    if (!repo) {
      return res.status(400).json({ error: 'repo is required (owner/name format)' });
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
        const result = execSync(
          `gh issue create --repo "${repo}" --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --label "${labels}"`,
          { encoding: 'utf8', timeout: 30000 }
        );
        const issueUrl = result.trim();
        created.push({ findingId: finding.id, issueUrl });
      } catch (ghErr) {
        created.push({ findingId: finding.id, error: ghErr.message });
      }
    }

    res.json({ created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/export/report - generate markdown report
router.post('/report', (req, res) => {
  try {
    const { findingIds, template } = req.body;
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

    res.json({ report: report.join('\n') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
