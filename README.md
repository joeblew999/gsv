# GSV
![gsv](https://github.com/user-attachments/assets/dba02d8f-3a3a-40c5-b38f-5eea3b2ea99d)
**GSV** is a distributed operating system for humans, machines, and agents. In simpler terms, it is a personal cloud AI computer built on Cloudflare's global infrastructure.

GSV unifies your devices (laptops, servers, phones, etc.) in a cloud OS with AI built into the kernel. Agents are modeled as processes: they have identities, durable history, permissions, parent/child relationships, and a syscall surface for using OS capabilities.

It offers an SDK for native applications and comes with a built-in git remote that can host GSV itself. That means agents can own repositories, packages can be self-hosted, and apps can be shared with other GSV instances like a distributed app store.

Named after the planet-scale sentient ships from Iain M. Banks' Culture series, GSV (General Systems Vehicle) provides a foundation for self-aware personal AI that exists as ephemeral beings spawning across the Earth's edge network.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/deathbyknowledge/gsv)
## Quick Start

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (Workers Paid plan required)

### Deploy

```sh
# Installs CLI
curl -sSL https://install.gsv.space | bash
# Deploys all components to your Cloudflare account
gsv infra deploy --api-token <CLOUDFLARE-API-TOKEN>
```

Once the deployment finishes open the URL to finish your onboarding through the Web UI.

### Chat

You can interact with any of the Agent processes in your GSV in multiple ways:

- Through the built-in **Chat** app in the web UI
- By messaging through any connected adapter, such as WhatsApp or Discord
- Or through the CLI directly:

```bash
gsv chat "Hello, what can you help me with?"
```

### Connect a Device
Devices connected to your GSV user are reachable by your agents from anywhere on Earth.

Easily add a device through the **Devices** app in the Web UI or do it directly from the CLI:

```bash
# Create a token for the device (make a note of it)
gsv auth token create --device macbook --label Macbook
# Set the token
gsv config --local set node.token <token>
# Manual install/start as a background service:
gsv device install --id macbook --workspace ~/

# Check status/logs
gsv device status
gsv device logs --follow

# Instead of a background service you can run it in the foreground:
gsv device run --id macbook --workspace ~/projects
```

Node logs are structured JSON at `~/.gsv/logs/node.log` with app-side rotation
(default: 10MB, 5 files). Override with `GSV_NODE_LOG_MAX_BYTES` and
`GSV_NODE_LOG_MAX_FILES`.

Now GSV can use the shell, read and write files on your machine.

### Adapters

The easiest way to set up adapters is through the **Adapters** app in the Web UI.

### OS Model

GSV intentionally feels Linux-like so agents can reason about it with familiar operating-system patterns. This is a mental model, not POSIX compatibility.

- **Kernel**: the Gateway runs on Cloudflare and exposes authenticated syscalls such as `proc.*`, `pkg.*`, and `sys.*`.
- **Processes**: agents are durable processes with PIDs. They can be listed, spawned, messaged, reset, or killed with `gsv proc list`, `gsv proc spawn`, `gsv proc send`, and `gsv proc kill`.
- **Init process**: each user has a default long-lived process, similar to an interactive login shell for that user.
- **Devices**: connected machines act like execution nodes. They provide shell and filesystem tools scoped to the configured workspace.
- **Packages and apps**: built-in and user packages behave like OS applications that call the Gateway through the app SDK.
- **Adapters**: WhatsApp, Discord, and other channel workers act like device drivers for external message surfaces.

### Components

- **Gateway** - Central brain running on Cloudflare, serves as the OS kernel. Manages auth, filesystem state, routing, and exposes system calls that processes and apps use to access GSV capabilities.
- **Processes** - Each agent is a process in the GSV OS with persistent history and its own agent loop.
- **Devices** - Your devices connected to GSV, providing remote tool access (Bash, Read, Write, Edit, Search).
- **Adapters** - Bridges to WhatsApp, Discord, etc. Each runs as a separate Worker.

## Development

### Prerequisites

- [Rust](https://rustup.rs) (for CLI)
- [Node.js + npm](https://nodejs.org) (for package installation)

```bash
# Install JS deps across the workspace, adapters, and ripgit
./scripts/setup-deps.sh

# Start the local multi-worker development stack
npm run dev

# CLI
cd cli && cargo build --release

# Build local Cloudflare bundles and deploy via CLI
./scripts/build-cloudflare-bundles.sh
gsv deploy up --bundle-dir ./release/local --version local-dev --all --force-fetch

# Local-bundle deploy shortcut (defaults to `-c gateway`)
./scripts/deploy-local.sh
./scripts/deploy-local.sh -c gateway --force-fetch
```

## Running on the `joeblew999` branch (mise + nushell + aube)

This branch adds a [mise](https://mise.jdx.dev) + [nushell](https://www.nushell.sh) orchestration layer on top of the upstream scripts. Upstream `scripts/` is unchanged; everything here is additive.

### First-time setup (~30 seconds)

```bash
mise install                # nushell, fnox, gh, jq, aube, node, rust, zig, pitchfork, worker-build
fnox set --provider keychain CLOUDFLARE_API_TOKEN     # only if deploying to CF
fnox set --provider keychain CLOUDFLARE_ACCOUNT_ID
mise run cf:token-check     # ✓ verifies CF token (only if you set the above)
```

### Run it locally (no Cloudflare spend)

```bash
mise run system-local       # 1-deps → 2-build-web → 3-build-rust → 4-build-cli → 8-up-local → 9-onboard-local
```

When it finishes: http://localhost:8787 is serving, user `joe` is onboarded, password is in fnox (`fnox get GSV_PASSWORD`).

### Run it on Cloudflare

```bash
mise run system-cloud       # 1→4 + 5-build-bundles + 6-deploy-cloud + 7-onboard-cloud
mise run destroy-cloud      # tear it down
```

### Wire your laptop in as a device

```bash
gsv auth token create --kind node --device macbook --label macbook
gsv config --local set node.token <token-from-above>
gsv config --local set gateway.url wss://gsv.<account>.workers.dev/ws   # or ws://localhost:8787/ws
mise run 10-up-device
mise run prove-device
```

### Everything in one shot

```bash
mise run system-up          # cloud + local + device, in correct order
```

### Day-to-day

```bash
mise run status             # what daemons are running?
mise run prove-local        # ✓ local serving?
mise run prove-cloud        # ✓ cloud serving?
mise run prove-chat         # end-to-end chat round-trip
mise run prove-all          # all probes
mise run down               # stop local daemons
```

### Numbered task reference

| # | Task | What |
|---|---|---|
| 1 | `1-deps` | aube install across workspace + adapters + ripgit |
| 2 | `2-build-web` | vite build → `web/dist` |
| 3 | `3-build-rust` | sequential `worker-build` for assembler + ripgit (sidesteps cargo cache contention) |
| 4 | `4-build-cli` | `cargo build --release` for the gsv CLI |
| 5 | `5-build-bundles` | wrangler --dry-run → `release/local/*.tar.gz` (cloud only) |
| 6 | `6-deploy-cloud` | `gsv infra deploy --all` (uses fnox token) |
| 7 | `7-onboard-cloud` | `gsv auth setup` against the cloud gateway |
| 8 | `8-up-local` | `pitchfork start dev-stack` (wrangler dev on :8787) |
| 9 | `9-onboard-local` | `gsv auth setup` against `ws://localhost:8787/ws` |
| 10 | `10-up-device` | `pitchfork start device` (needs token + gateway.url set) |

Composites: `system-local` (1, 2, 3, 4, 8, 9) · `system-cloud` (1→7) · `system-up` (everything + 10).

### CI

`.github/workflows/mise.yml` parse-checks every nu task file on Linux + macOS + Windows. Triggered automatically on push to `joeblew999`, or manually:

```bash
gh workflow run mise.yml --ref joeblew999 --repo joeblew999/gsv
```

## License

MIT
