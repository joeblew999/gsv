# GSV: What it is and what it can do

GSV is a Cloudflare-native distributed OS for AI agents. It is **not** just a CLI — the CLI is one of five deployable runtime layers.

## The five runtime layers

| Layer | Where it runs | What it owns |
|---|---|---|
| **Gateway worker** | Cloudflare Worker + Durable Objects | The "kernel" — auth, syscalls (`proc.*`, `pkg.*`, `sys.*`), process runtime, package management, model/inference dispatch, websocket protocol |
| **Web shell** | Cloudflare Worker / Pages | Login + setup flows, the desktop frame, iframe host bridge for builtin apps, app/window orchestration |
| **ripgit worker** | Cloudflare Worker | Git-backed storage for the agent filesystem; hosts a self-hosted git remote that can host GSV itself |
| **Adapter (channel) workers** | One Cloudflare Worker per platform | Bridges to external messaging platforms (WhatsApp, Discord today; `test` for e2e). Each owns its own DO for persistent connections. |
| **CLI + device daemon** | Local Rust binary | User-facing control plane; also runs as a long-lived "device" daemon so remote agents can drive your local shell/files |

Layers communicate via Cloudflare **service bindings** (typed, in-account RPC between workers — no public webhooks). See [docs/explanation/channel-model.md](../docs/explanation/channel-model.md) for why.

## Process model

Agents are modeled as **processes** with PIDs, durable history, parent/child relationships, and a syscall surface:

- `proc.spawn`, `proc.send`, `proc.history`, `proc.abort`, `proc.reset`, `proc.kill`
- Each user has a default long-lived "init" process — like an interactive login shell
- Each Process is a Durable Object, so history and pending tool calls survive restarts
- Sessions route inbound messages to the right process based on a configurable `dmScope` (`main`, `per-peer`, `per-channel-peer`, `per-account-channel-peer`)

## Builtin apps (the "desktop")

Builtin apps live under [builtin-packages/](../builtin-packages/) and render inside the web shell via the iframe host bridge. Today's set:

- `chat` — talk to processes
- `shell` — interactive shell connected to gateway OS
- `files` — browse/edit target filesystems
- `processes` — inspect and control process lifecycle
- `devices` — manage connected execution targets
- `control` — system settings, tokens, access
- `packages` — package lifecycle and source management
- `adapters` — channel/account configuration UI
- `wiki`, `doctor`, `ascii-starfield` — utility/demo apps

Builtins are synced from the user's `root/gsv` git repo via ripgit — changing a builtin does **not** require a gateway redeploy.

## Channel/adapter capabilities

Every adapter implements `ChannelWorkerInterface`:

```ts
start(accountId, config) → StartResult
stop(accountId) → StopResult
status(accountId?) → ChannelAccountStatus[]
send(accountId, message) → SendResult
setTyping?(accountId, peer, typing)
login?(accountId, options?) → LoginResult
logout?(accountId) → LogoutResult
```

Plus a static `capabilities` matrix (chat types, media, reactions, typing, threads, editing, login style).

## CLI surface

`gsv --help` exposes:

| Subcommand | Purpose |
|---|---|
| `chat` | Send a message to the agent (interactive or one-shot) |
| `shell` | Interactive shell connected to the gateway OS |
| `proc` | Process management (`proc.*`) |
| `adapter` | Adapter account lifecycle |
| `auth` | Authentication and onboarding |
| `device` | Run/manage the local device daemon |
| `config` | Get/set gateway or local config |
| `packages` | Package lifecycle and source management |
| `infra` | Cloudflare infrastructure lifecycle (`deploy` / `upgrade` / `destroy`) |
| `version` | CLI version + build metadata |

## Deploy paths

- **`gsv infra deploy --all`** — provisions Workers, DOs, R2 buckets, KV namespaces, queues in your CF account; needs a Workers Paid plan + API token
- **`gsv infra deploy --bundle-dir release/local`** — same, but from locally-built bundles (via [scripts/build-cloudflare-bundles.sh](../scripts/build-cloudflare-bundles.sh))
- **`mise run dev`** — local multi-worker stack via wrangler dev, no Cloudflare account needed

## What this enables (vs "just a CLI")

- A **hosted web desktop** for agents (chat, shell, files, processes, etc.)
- **Multi-channel reach**: same agent reachable from CLI, WhatsApp, Discord, Web, with shared or scoped conversation state
- **Local device tools**: agents can run shell/read/write/edit on your machine via the device daemon
- **Self-hosted git remote** that can host GSV itself — agents can own repos, packages can be self-hosted, instances can share apps
- **Process durability**: conversations and tool calls survive worker restarts via Durable Objects
- **OS metaphor**: PIDs, init process, syscalls, devices, packages — agents can reason about it with familiar OS patterns

## Source-of-truth references

- [README.md](../README.md) — quick start, deploy, components
- [AGENTS.md](../AGENTS.md) — runtime model, update paths per layer, validation guidance
- [CHANNELS.md](../CHANNELS.md) — channel architecture diagrams
- [docs/explanation/channel-model.md](../docs/explanation/channel-model.md) — why service bindings, session keys, dmScope
- [docs/explanation/architecture.md](../docs/explanation/architecture.md) — system architecture
