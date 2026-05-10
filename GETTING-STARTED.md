# Getting Started

Daybreak Solana runs a Node server that orchestrates Claude-powered security agents against Solana program source code. The server serves a React dashboard on the same port.

There are two ways to run it: **locally** (for development) or via **Docker** (one command, no host dependencies).

---

## Prerequisites (both methods)

- **Claude CLI authentication.** The agents call `claude` under the hood. You need either:
  - Interactive auth (run `claude` once and follow the link), or
  - An `ANTHROPIC_API_KEY` environment variable.

---

## Option A: Local Setup

### Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | Runtime for server and client build |
| Python 3 | 3.9+ | tree-sitter prescan extractors |
| Claude CLI | latest | `npm install -g @anthropic-ai/claude-code` |
| ast-grep | latest | Optional. `npm install -g @ast-grep/cli` |
| cargo | stable | Optional. Enables clippy + cargo-audit prescan |

### Steps

```bash
# 1. Install dependencies
npm run setup          # checks deps, installs node_modules + Python packages

# 2. Authenticate Claude CLI (one-time)
claude                 # follow the auth link in your browser

# 3. Start dev server (server + client with hot reload)
npm run dev            # server on :3000, client on :5173
```

Open `http://localhost:5173` in your browser.

The setup script (`scripts/setup.sh`) checks every dependency and reports what's missing, what's optional, and what will be skipped.

### Production build (local)

```bash
npm run build          # builds client into client/dist
npm start              # serves everything on :3000
```

---

## Option B: Docker

Docker bundles Node, Python, tree-sitter, ast-grep, and the Claude CLI into a single image. No host dependencies besides Docker.

### Requirements

| Tool | Version |
|------|---------|
| Docker | 20.10+ |
| Docker Compose | v2+ (included with Docker Desktop) |

### Steps

```bash
# 1. Build and start
docker compose up -d

# 2. Authenticate Claude CLI (one-time, interactive)
docker compose exec daybreak claude
# Follow the auth link in your browser, then exit with Ctrl+C

# 3. Open the dashboard
open http://localhost:3000
```

The container binds to `127.0.0.1:3000` only -- not exposed to your LAN.

### Using an API key instead of interactive auth

If you prefer key-based auth, pass `ANTHROPIC_API_KEY` via the environment:

```yaml
# docker-compose.yml, add under environment:
environment:
  - PORT=3000
  - BIND_HOST=0.0.0.0
  - ANTHROPIC_API_KEY=sk-ant-...
```

Or pass it at the command line without editing the file:

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d
```

### Auditing a local project

By default the container can only see its own filesystem. To audit a Solana project on your host machine, bind-mount it:

```yaml
# docker-compose.yml, add under volumes:
volumes:
  - /path/to/your/solana-project:/audit/target
```

Then set the target path to `/audit/target` in the dashboard setup.

### Persistent data

| Volume/Mount | Purpose |
|---|---|
| `claude-auth` (named volume) | Claude CLI session, survives rebuilds |
| `./state` | Scan progress, findings, prescan data |
| `./saved-audits` | Exported and archived audits |

### Container security

The Docker setup is hardened by default:

- Runs as non-root user `daybreak`
- Read-only root filesystem
- `no-new-privileges` security option
- `init` for signal forwarding and zombie reaping
- Memory capped at 4 GB, CPU capped at 2 cores
- Port bound to localhost only

### Useful commands

```bash
docker compose up -d              # start in background
docker compose logs -f             # tail logs
docker compose down                # stop
docker compose up -d --build       # rebuild after code changes
docker compose exec daybreak whoami  # verify non-root (prints "daybreak")
```

---

## Verify the install

Whether local or Docker, these checks confirm everything is working:

1. Dashboard loads at `http://localhost:3000` (Docker) or `http://localhost:5173` (local dev)
2. Create a new audit, point it at a Solana project
3. Accept scope, start a scan -- agent progress should appear in the dashboard
