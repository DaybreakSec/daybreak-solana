# Daybreak Solana

Automated security audit tool for Solana programs. Daybreak runs a pipeline of specialized Claude-powered agents against your program's source code, preceded by static analysis, and presents findings in a web dashboard.

## How It Works

```
prescan -> scout -> 5 agents (parallel) + threat model -> deepening -> synthesis -> validation
```

**Prescan** extracts structural data using tree-sitter extractors, ast-grep rules, clippy, and cargo-audit. Outputs feed into agents as prioritized context.

**Scout** maps program structure: instructions, accounts, access control, data flows.

**Five scanning agents** run in parallel, each covering a vulnerability domain:

| Agent | Domain |
|-------|--------|
| `accounts-access` | Account validation, access control |
| `cpi-token` | Cross-program invocation, token ops |
| `arithmetic-economic` | Math safety, economic attacks |
| `state-lifecycle` | State machines, account lifecycle |
| `invariant-logic` | Business logic, conservation laws |

**Threat model** produces a security architecture map: actors, trust boundaries, invariants, attack surfaces.

**Deepening** re-runs owning agents on high/critical findings for focused re-analysis.

**Synthesis** looks across all findings for compound vulnerabilities and coverage gaps.

**Validation** is a pessimistic adversarial agent that tries to disprove every finding.

## Getting Started

See [GETTING-STARTED.md](GETTING-STARTED.md) for full setup instructions.

### Local

```bash
npm run setup              # check deps, install packages
claude                     # one-time auth
npm run dev                # server :3000 + client :5173
```

### Docker

```bash
docker compose up -d
docker compose exec daybreak claude    # one-time auth
# open http://localhost:3000
```

### Authentication

Daybreak uses the Claude Code CLI for authentication. Running `claude` once opens a browser-based OAuth flow that persists credentials locally. In Docker, the `claude-auth` volume keeps the session across container restarts.

## Requirements

| Tool | Required | Notes |
|------|----------|-------|
| Node.js 18+ | Yes | Server runtime, client build |
| Python 3.9+ | Yes | tree-sitter prescan extractors |
| Claude CLI | Yes | `npm install -g @anthropic-ai/claude-code` |
| ast-grep | No | Pattern rules skipped if missing |
| cargo | No | Clippy + cargo-audit skipped if missing |
| Docker 20.10+ | No | Alternative to local setup |

## Remote Access (VPS / headless server)

If you're running Daybreak on a remote server (VPS, cloud instance, etc.), use an SSH tunnel to access the dashboard from your local machine — no ports need to be exposed to the internet.

```bash
# From your local machine:
ssh -L 5173:localhost:5173 -L 3000:localhost:3000 user@your-server-ip
```

Then open `http://localhost:5173` (dev mode) or `http://localhost:3000` (production) in your local browser.

To make this persistent, add to `~/.ssh/config`:

```
Host daybreak-server
  HostName your-server-ip
  User your-username
  LocalForward 5173 localhost:5173
  LocalForward 3000 localhost:3000
```

Then just `ssh daybreak-server` and the ports are forwarded automatically.

## License

MIT
