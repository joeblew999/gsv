# ADR 0004 — Cloudflare Agents SDK + ai-chat GUI as a parallel agent surface

- **Status:** Proposed (quick / draft)
- **Date:** 2026-05-06
- **Deciders:** project owner (joeblew999)
- **Tags:** ui, agents, cloudflare, react, hono, additive
- **Reference impl:** [`/Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick) — same author, same stack, deployed and live

## Context

The user has shipped a working Cloudflare Worker that integrates the official **Cloudflare Agents SDK + pre-built chat GUI** in [`mon-house/quick/cf/`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick/cf/). That stack:

| Package | Role |
|---|---|
| `agents` | Cloudflare Agents SDK — provides `routeAgentRequest`, `AIChatAgent` base DO with WebSocket, state management |
| `@cloudflare/ai-chat` | Pre-built React chat UI; pairs with `useAgentChat` hook over WebSocket to the Agent DO |
| `workers-ai-provider` | Adapter to use Workers AI as a model provider for the SDK |
| `@cloudflare/shell` | Virtual FS — SQLite + R2 auto-spillover at 1.5 MB |
| `@cloudflare/kumo` | CF coordination/state primitive |
| `hono` | HTTP router; mounts `routeAgentRequest` at `/agents/*` |
| `@cloudflare/vite-plugin` + React 19 | SPA build |

In `quick/cf/src/index.ts` the integration is **30 lines**: import `routeAgentRequest`, mount it on Hono at `/agents/*`, export the `ChatAgent` class. The React SPA gets a working chat UI for free via `useAgentChat`.

This ADR records the question the user raised — *"this is making me think about how well it might also work with this repo btw"* — and gives a quick answer with a clear scope.

## The compatibility question

GSV already has parallel-shaped pieces:

| GSV's existing thing | CF Agents SDK equivalent |
|---|---|
| Gateway worker + custom WebSocket protocol | `routeAgentRequest` over `/agents/*` |
| Process DO with history + tool calls | `AIChatAgent` DO with WebSocket + state |
| `web/` Vite SPA + custom desktop UI | React + `@cloudflare/ai-chat` UI |
| ripgit R2-backed agent FS | `@cloudflare/shell` SQLite + R2 spillover |

Replacing any of these would violate the additive-only principle from [ADR 0003](0003-cablehead-web-gui.md). **So this ADR is not a migration plan.** It's a proposal to run the CF Agents stack **alongside** upstream's existing surfaces, on a separate URL/route space, for use cases that don't already have a home.

## Decision drivers

- **Already proven by the same author.** The `quick/cf/` integration is live, deployed, and the user has the muscle memory.
- **Pre-built UI = zero design cost** for a new agent surface. `useAgentChat` + `@cloudflare/ai-chat` ship a working chat UI in <50 lines of React.
- **Workers-native.** No runtime conflict with the gateway worker — the SDK is designed for exactly this environment.
- **Separate URL space (`/agents/*`) means no conflict with upstream's protocol** — the existing gateway WebSocket and HTTP routes stay exactly as-is.
- Layer alignment with [ADR 0003](0003-cablehead-web-gui.md): the cablehead/http-nu stack is for **device-local** UIs; the CF Agents SDK is for **cloud-side, hosted** UIs. Different runtimes, different roles, no overlap.

## Considered options

1. **Replace the existing gateway protocol + process DO + chat UI with the CF Agents SDK.** Rejected — violates the additive principle, requires rewriting upstream's load-bearing code, and the upstream maintainer's protocol works fine.
2. **Don't adopt; keep gateway monolithic.** Status quo. Loses the "new agent surface for free" lever and ignores a pattern the user already runs in production elsewhere.
3. **Adopt as a parallel stack on a new URL space.** Recommended.

## Decision

**Mount the Cloudflare Agents SDK alongside the existing gateway**, on a dedicated URL space (`/agents/*`), with its own React UI rendered into a new builtin app.

Concretely:

1. **New worker:** `adapters/agent-sdk/` (own Cloudflare Worker — same one-worker-per-channel pattern from [ADR 0001](0001-port-novu-adapters.md)). Hosts `routeAgentRequest` + one or more `AIChatAgent` subclasses. Service-bound from the gateway.
2. **New builtin app:** `builtin-packages/agent-sdk-chat/` — a React SPA that uses `useAgentChat` against the new worker. Loaded into the desktop frame as another iframe-hosted builtin, alongside `chat`, `shell`, `files`, etc.
3. **No changes to upstream.** The existing `gateway/`, `web/`, `builtin-packages/chat/`, process DOs, and websocket protocol stay exactly as the upstream maintainer wrote them.
4. **Shared model provider.** Both the existing gateway's inference layer and the new SDK-based agent use the same Workers AI binding (or the same configured external model), so the user has one place to set the model preference.

### What this gives us

- A **second chat surface** that uses the CF SDK's batteries-included UI — useful as an experimentation playground, a fallback when the main chat UI is being reworked, or a place to try new SDK features without touching the main builtin.
- A clean home for **agents that don't fit the existing process model**: e.g. a stateless one-shot helper, an SSE-streaming summariser, anything where the SDK's shape matches better than GSV's process DO.
- A reusable pattern for any new specialised agent — drop another `AIChatAgent` subclass into `adapters/agent-sdk/` and add a corresponding builtin if you want a UI for it.

### What's out of scope

- **No replacing the chat builtin.** The existing `builtin-packages/chat/` stays untouched.
- **No replacing the process model.** GSV processes are richer than `AIChatAgent` (devices, tool routing, parent/child, channel inbound). The SDK is for surfaces where that richness isn't needed.
- **No swapping ripgit for `@cloudflare/shell`.** If we want shell-backed VFS later that's a separate ADR; ripgit is the upstream agent FS and it stays.
- **No D1/Kumo migration of state.** The existing process DOs handle persistence; the new SDK agents get their own DO state via the SDK's defaults.

## Consequences

**Positive**

- Working chat UI for any new agent in <50 lines of React
- Pattern matches what the user already runs in `quick/`
- One more Worker in the deploy surface — fits the existing per-channel-per-worker model
- Layer split with [ADR 0003](0003-cablehead-web-gui.md) is clean: SDK = cloud, http-nu = device

**Negative**

- Two chat UIs (existing builtin + SDK-based builtin) — could confuse users without clear product framing. Mitigation: name and position the new builtin as "experimental" or scoped to a specific job (e.g. "spec helper", "scratchpad")
- React + the SDK adds bundle weight to the deploy
- SDK's chat UX conventions may diverge from upstream's — own that as a feature, not a bug (it's a different surface)
- Locks the new surface to Cloudflare-specific primitives (the SDK; the chat UI). Acceptable — GSV is already Cloudflare-native end-to-end

## Implementation plan

1. **Spike** (~1 day): copy [`quick/cf/`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick/cf/) into `adapters/agent-sdk/`; strip the Thai-translation specifics; keep the `routeAgentRequest` + `ChatAgent` skeleton; verify it builds and `wrangler dev` runs alongside the existing dev stack.
2. **Wire into gateway**: add a service binding from `gateway/` to `adapters/agent-sdk/` so the desktop builtin can reach it via gateway routing (or expose it directly if simpler — TBD during spike).
3. **New builtin app** `builtin-packages/agent-sdk-chat/`: minimal React app importing `@cloudflare/ai-chat` + `useAgentChat`, points at the new worker.
4. **Add to mise + CI**: extend the existing wrangler-based deploy flow with a `notify-*`-style entry for the new worker (mirrors the [ADR 0001](0001-port-novu-adapters.md) per-channel-per-worker pattern).
5. **Document scope** in `notes/`: what this surface is for vs. the upstream chat builtin.

## Open questions

- **Where does the React app live in the build?** `quick/cf/` uses Vite via `@cloudflare/vite-plugin` to produce both the Worker and the SPA bundle in one config. GSV's `web/` already uses Vite. Either: the new builtin gets its own Vite config like `quick/`, or it's added as another build target inside `web/`. Spike will tell which is cleaner.
- **Does the new agent share auth with the gateway?** Easiest path: the desktop iframe-hosts both, the gateway proxies auth to the new worker via service binding. Decide during spike.
- **Workers AI model choice.** `quick/` uses Workers AI directly via `workers-ai-provider`. GSV's gateway has its own model dispatch (`gateway/src/inference/`). For the new agent, simplest is to use Workers AI directly via the SDK's defaults; revisit if the user wants centralised model config.

## References

- [`mon-house/quick/cf/src/index.ts`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick/cf/src/index.ts) — 30-line integration of `routeAgentRequest` + Hono + `ChatAgent`
- [`mon-house/quick/cf/src/chat.ts`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick/cf/src/chat.ts) — `ChatAgent extends AIChatAgent` example
- [`mon-house/quick/cf/package.json`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick/cf/package.json) — full dep set the user has running in production
- [`mon-house/quick/cf/CLOUDFLARE.md`](file:///Users/apple/workspace/go/src/github.com/joeblew999/mon-house/quick/cf/CLOUDFLARE.md) — what's deployed, what works, what doesn't
- [Cloudflare Agents SDK docs](https://developers.cloudflare.com/agents/) — official reference
- ADR 0003: [Cablehead web GUI](0003-cablehead-web-gui.md) — the device-local layer; this ADR is the cloud-side complement
- ADR 0001: [Novu adapters](0001-port-novu-adapters.md) — same one-worker-per-channel pattern applied to a different surface
