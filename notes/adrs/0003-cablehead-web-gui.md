# ADR 0003 — Adopt cablehead's http-nu + stacks.nu for device-local web GUIs

- **Status:** Proposed
- **Date:** 2026-05-06
- **Deciders:** project owner (joeblew999)
- **Tags:** ui, device, nushell, http-nu, stacks.nu, datastar, sse

## Context

[`cablehead/http-nu`](https://github.com/cablehead/http-nu) is a Rust HTTP server whose request handlers are **nushell closures**. From its README:

> The surprisingly performant, Nushell-scriptable, cross.stream-powered, Datastar-ready HTTP server that fits in your back pocket.

```bash
http-nu :3001 -c '{|req| "Hello world"}'
```

It ships with batteries: SSE (`to sse`), HTML DSL, minijinja templates (`.mj`), Datastar SDK (`to datastar-patch-elements`), embedded SQLite (`stor`), cross.stream event log, static file serving, reverse proxy, hot-reload via `-w`. Content-type is inferred from nu pipeline value types.

[`cablehead/stacks.nu`](https://github.com/cablehead/stacks.nu) is the canonical example app: an event-sourced clipboard manager. Its architecture is the interesting bit:

> The page holds no state. Selection, mode, the visible HTML — all projected on the server from frames in the event store.

Run it with:

```bash
http-nu --datastar --store ./store :4777 -w ./www/serve.nu
```

Persistent events drive the model (`stack.add`, `clip.add`, …); ephemeral events drive UI state (`*.select`, modals); the server projects HTML from the event log and patches the DOM via SSE+Datastar. Keyboard-driven, no client framework.

**Why this ADR exists:** these tools are nushell-native, which aligns with the org-wide direction (shared mise-tasks library v0.10.0 is fully nu; ADR 0002 proposes porting gsv's internal scripts). The user has signalled wanting to use them for a web GUI.

**The constraint that defines the scope:** GSV's two primary execution surfaces are very different.

| Surface | Runtime | Can run http-nu? |
|---|---|---|
| Gateway worker | Cloudflare Worker | **No** — no nushell, no long-lived process, no embedded SQLite, no cross.stream. http-nu is fundamentally incompatible with the Workers runtime. |
| Web shell | Cloudflare Worker (assets) | **No** — same reason; the desktop frame is served as static assets from CF. |
| `gsv device` daemon | Local Rust process on user's machine | **Yes** — it's already a long-lived local process; embedding/launching http-nu is straightforward. |
| `ripgit` worker | Cloudflare Worker | **No**. |
| Adapter workers | Cloudflare Workers | **No**. |

This means http-nu cannot replace the existing CF-hosted web shell. But it *is* a perfect fit for the device-local layer, which today has effectively no UI (`gsv device status` / `gsv device logs` are CLI-only).

## Decision drivers

- **Nushell alignment.** Org standard is nu. Adopting http-nu reinforces it; rejecting it diverges. This is the strongest pull.
- **Runtime-changeable UIs.** This is the load-bearing point. stacks.nu's architecture makes the *handler script itself* the UI — `http-nu -w ./www/serve.nu` hot-reloads on file change, with no client build step, no bundler, no deploy cycle. **Edit the nu file → save → the running UI updates.** Combined with event sourcing (state projects from the log; the log doesn't change when the projection logic changes), this means the UI can be reshaped while it's live without losing state. For GSV specifically, this unlocks a pattern that's hard or impossible with the CF-hosted SPA: **agents can generate, evolve, and retire their own UIs at runtime.** An agent writes a `serve.nu` to triage a task, refines it as it learns the data, and the user's view updates live. No build, no deploy, no version bump. This is the SPA-replacement thesis baked into the tool.
- **The device daemon has no UI today.** Status, pending tool calls, shell.exec history, log tailing — all CLI text. A small local web UI is a real product gap.
- **Agents can serve local UIs that the cloud-hosted desktop can iframe.** This unlocks UI for workloads where the data is fundamentally local (large local files, fast disk I/O, sensitive content that should not transit CF). Today there's no path for an agent to render a local-served UI.
- **Datastar/SSE matches GSV's existing protocol.** The gateway already speaks WebSocket frames between agents and the desktop. Adding SSE-driven HTML for device-local UIs is consistent, not a paradigm shift.
- **stacks.nu's event-sourced pattern echoes GSV's process-DO model.** Both project state from an append-only log. The architectural mental model transfers — and the agent-as-process abstraction maps cleanly onto agent-as-UI-author.

## Considered options

1. **Replace the CF-hosted web shell with http-nu/stacks.nu.** Rejected — physically impossible on Workers runtime. http-nu requires nushell + a process model that Workers doesn't provide.
2. **Don't adopt; keep device daemon CLI-only.** Status quo. Rejected — misses the alignment opportunity and leaves the device-side UI gap unaddressed.
3. **Adopt for device-local UIs only.** Recommended. Two concrete surfaces (below).
4. **Adopt only as documentation/dev tooling** (e.g. replace the VitePress docs site with stacks.nu-powered docs). Rejected — too narrow, doesn't help users, just adds tooling churn.

## Decision

Adopt option 3. Use http-nu as a local UI server inside or alongside the `gsv device` daemon, for two specific surfaces:

### Guiding principle: additive only, never replace

This is a fork of [deathbyknowledge/gsv](https://github.com/deathbyknowledge/gsv). **No part of this ADR replaces or modifies upstream GSV code.** New files only — new CLI subcommand, new syscall, new builtin app for framing local UIs, new device daemon sub-process. Existing builtin apps, the web shell, the gateway, and the iframe host bridge stay as the upstream maintainer wrote them. The exception is Surface B's host-bridge change (allowing `127.0.0.1` URLs); that's the smallest possible additive extension to an existing surface, and is called out explicitly in Phase 2 below for that reason.

If at any point the implementation pressure pushes toward modifying upstream code instead of adding alongside, **stop and reconsider the design**. The point of this ADR is to demonstrate that the cablehead stack composes naturally with GSV's device layer; if the composition forces upstream rewrites, the composition story is wrong.

### Surface A — Device shell (local operator UI)

A local web UI at `http://127.0.0.1:<port>` that exposes:

- Device daemon state (connected? authenticated? token id? gateway URL?)
- Active shell.exec invocations + recent history
- Pending tool calls being routed to this device
- Live `node.log` tail (today: `gsv device logs --follow`)
- Workspace summary (resolved path, git status of repos under it)
- A button to stop/restart the daemon

This replaces (or complements) `gsv device status` / `gsv device logs` text output. Built using the stacks.nu pattern: events from the daemon's existing log + tool-call stream become the event source; HTML projected via minijinja; DOM patched via Datastar SSE.

Off by default; enabled with `gsv device run --ui` or `[device.ui] enabled = true` in local config. Bound to `127.0.0.1` only — no auth other than localhost binding, since anyone with shell on this machine already has shell.exec equivalence anyway.

### Surface B — Agent-spawned local UIs (the runtime-changeable surface)

A new device-side syscall (provisional name: `device.serve-ui`) that lets an agent ask the device daemon to spin up an http-nu instance with a given handler script, and returns a URL. The desktop's iframe host can then frame that URL alongside CF-served builtin apps.

This is where the **runtime-changeable** property pays off. The handler script is just a `serve.nu` file the agent owns and can rewrite. http-nu's `-w` flag watches it and reloads on change. The user's iframe stays open; the UI evolves live as the agent refines the script. State stays consistent because it's projected from the event log, not held in the page.

Use cases:
- One-off agent-built tooling: *"make me a UI to triage these 4000 photos in `~/Pictures`"* — agent writes `serve.nu`, refines it as it sees what the user clicks, retires it when done. No deploy cycle, no version bump, no committing UI code.
- A `local-files` builtin variant that renders directly from disk via http-nu (no R2 round-trip, no iframe-to-DO syscall chain).
- Diagnostic surfaces (memory, disk, processes) where data should never leave the machine — and where the UI shape adapts to what's interesting *right now*.
- Long-lived agent-managed dashboards (e.g. a personal-fitness tracker UI written by an agent that adds new sections as the user logs new data types).

Constraints:
- Requires desktop's iframe host bridge to permit http URLs from `127.0.0.1`/`localhost` (currently it likely only accepts gateway-served origins). This is a small but real change to the host bridge.
- Each spawned UI is owned by the spawning process; killing the process kills the http-nu sub-process.
- Lifecycle: the daemon allocates ports from a configurable range, tracks them per-process, cleans up on process exit.
- Because the agent controls the handler script, it can also **introduce a bad UI live**. The runtime-changeable property is double-edged. Mitigation: every script update is itself an event in the agent's history, so revert/audit are first-class.

### Out of scope

- **Replacing the CF web shell.** Cannot. Don't try.
- **Porting builtin apps to stacks.nu wholesale.** Today's builtin apps target the iframe-on-CF model. A wholesale rewrite is a separate ADR. *Future direction* worth flagging: builtin apps that have a "device-served variant" using stacks.nu patterns.
- **Replacing the docs site.** VitePress works; not the right battle.
- **Putting http-nu inside the gateway.** Workers runtime makes this impossible.

## Consequences

**Positive**

- Closes the device-side UI gap with idiomatic nushell, aligned with org direction
- Unblocks a class of UIs (large-local-data, sensitive-local-data) that the CF-hosted desktop alone cannot serve
- Datastar/SSE pattern is small, well-understood, and complements (does not compete with) the gateway's existing WebSocket protocol
- stacks.nu gives a concrete, copyable reference implementation — we don't have to figure out the patterns from scratch

**Negative**

- Adds a runtime dep (http-nu binary) to the device daemon's installation surface. Mitigation: distribute via the existing `gsv device install` flow; consider bundling vs. PATH-resolved.
- Two UI runtimes (CF-served vanilla TS for the desktop frame; http-nu+nu+Datastar for device-local). Two mental models. Mitigation: clear ownership boundary — anything global goes through the desktop; anything device-local goes through http-nu.
- nushell version coupling. http-nu pins specific nu version ranges; we already pin `0.112` via mise. If http-nu lags, we either skew the device's nu version from the org default or wait for http-nu releases. Mitigation: track http-nu releases; pin version explicitly in `mise.toml`.
- Iframe host bridge changes (Surface B) need security review — allowing `127.0.0.1` URLs in the desktop frame is a real boundary expansion.

## Implementation plan

Phased; each phase lands as its own PR.

### Phase 0 — spike

1. Vendor http-nu locally (`mise install` it via the binary; pin a release tag).
2. Write a 30-line `serve.nu` that reads the existing `~/.gsv/logs/node.log` and exposes a single page with last-100 entries + auto-refresh. **Goal:** prove http-nu integrates with the device's actual state, not invent a fictional API.
3. Stop here if friction is too high (nushell version conflict, packaging hell, etc.).

### Phase 1 — Device shell (Surface A)

1. Add `gsv device ui` subcommand: starts http-nu as a managed sub-process of the device daemon. Tracks PID, restarts on daemon restart.
2. Define the event source: tap into the daemon's existing structured log + tool-call routing stream (this likely needs a small daemon-side change to expose them as a tail-able stream).
3. Build the UI as a stacks.nu-style serve.nu: status panel, log tail, shell history, pending tool calls.
4. Document: add a `docs/how-to/device-ui.md`.

### Phase 2 — Agent-spawned UIs (Surface B)

1. Spec the `device.serve-ui` syscall — input (handler script path or inline), output (URL + ephemeral token). Define lifecycle and limits (max concurrent UIs per device, port range).
2. Implement port allocation + sub-process management in the device daemon.
3. Update the desktop's iframe host bridge to accept `http://127.0.0.1:<port>` origins when an explicit `serve-ui` URL is provided to the iframe app launcher.
4. Add a builtin app `local-ui` that's just a frame for showing such URLs in the desktop. (Or: extend `processes` to show "owned UIs" per process.)
5. Security review: localhost binding only; no exposing to LAN; ephemeral token in URL prevents same-machine cross-process access.

### Phase 3 — Optional follow-ups

- **stacks.nu as a builtin-app pattern.** If Phase 2 UIs prove the pattern, evaluate whether new builtin apps should default to the http-nu/Datastar/SSE approach for their device-served variant.
- **Replace `gsv device logs --follow` with auto-launching the device-shell UI.** Convenience, not strictly necessary.

## Open questions

- **Where does http-nu live in the install flow?** Bundled with `gsv` (single binary, fat install) or installed separately via mise (relies on user having mise)? Suggest: ship as a managed sub-process the device daemon downloads on first `gsv device run --ui` (similar to how cargo installs `worker-build` lazily). Avoids fattening the gsv binary.
- **What's the minimum viable event source on the daemon side?** Today's `node.log` is structured JSON, line-oriented — perfect for a tail-based pipeline into http-nu. Anything beyond that (tool-call stream, shell history) needs a small daemon-side API.
- **How do agent-spawned UIs (Surface B) authenticate?** Localhost binding makes network access not a concern, but cross-process access on the same machine is. Suggest: each spawned UI gets an ephemeral random path prefix; the URL handed to the desktop includes it; bare `localhost:port` returns 404.
- **Does this change the deploy story for the device daemon?** Probably yes — `gsv device install` may need to set up an http-nu sub-binary or a `mise install`-equivalent for pinning the version.
- ~~**Which nushell version does http-nu currently target?**~~ **Resolved.** Verified by reading [`.src/http-nu/Cargo.toml`](../../.src/http-nu/Cargo.toml): http-nu `0.15.1-dev` pins every `nu-*` crate at `0.112.1`. This matches the `0.112` already pinned via the shared mise library — **no version skew**. The device daemon and the rest of the toolchain can share the same nu pin.

## References

- [cablehead/http-nu](https://github.com/cablehead/http-nu) — nushell-scriptable HTTP server
- [cablehead/stacks.nu](https://github.com/cablehead/stacks.nu) — event-sourced reference app built on http-nu + xs + datastar
- [cablehead/cross.stream](https://github.com/cablehead/xs) — the embedded event store http-nu integrates with
- [Datastar](https://data-star.dev/) — hypermedia framework http-nu has built-in SDK support for
- GSV channel/device model: [docs/explanation/channel-model.md](../../docs/explanation/channel-model.md), [docs/how-to/run-a-node.md](../../docs/how-to/run-a-node.md)
- ADR 0002: [Port bash to nushell](0002-port-bash-to-nushell.md) — same nushell-first direction applied to project automation
- ADR 0001: [Port Novu adapters](0001-port-novu-adapters.md) — the "selective port" ADR style template
