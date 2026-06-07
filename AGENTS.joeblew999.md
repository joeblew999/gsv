# AGENTS.joeblew999.md — branch-local agent guide

Operational brief for the `joeblew999` branch of gsv. Generic mise + nu +
TOML-task conventions, shared-lib usage, cross-repo audit commands, and
all the org-wide "don'ts" live in **[.github/AGENTS.md](https://github.com/joeblew999/.github/blob/main/AGENTS.md)** —
read that first. This file is gsv-on-joeblew999-only stuff.

Three guides, in order:
1. [.github/AGENTS.md](https://github.com/joeblew999/.github/blob/main/AGENTS.md) — org SSOT.
2. [./AGENTS.md](./AGENTS.md) — upstream's project rules (deathbyknowledge/gsv).
3. This file.

## gsv-specific layout

| | What |
|---|---|
| [tasks/](tasks/) | TOML-tasks: `check.toml`, `test.toml`, `build.toml`, `prove.toml`, `system.toml`. Hidden `<ns>:_base` per file pins shared tools; children `extends`. |
| [pitchfork.toml](pitchfork.toml) | Long-lived daemons (`dev-stack`, `device`). |
| [.mise-bin/](.mise-bin/) | Local shims — `flock` (no-op for macOS) + `zig-cc` (target translator). |
| [renovate.json](renovate.json) | Renovate config (alternative to mise-upgrade workflow). |
| upstream `scripts/` | Bash. **Do not touch.** Used by wrangler `[build]` hooks; `.mise-bin/flock` makes them work on macOS. |

## Numbered orchestration (the workflow path)

```
1-deps          aube install (workspace + adapters + ripgit)
2-build-web     vite build → web/dist
3-build-rust    sequential worker-build (assembler + ripgit) — sidesteps cargo lock contention
4-build-cli     cargo build --release for cli/
5-build-bundles wrangler --dry-run → release/local/*.tar.gz (cloud only)
6-deploy-cloud  gsv infra deploy --all (uses fnox CF token)
7-onboard-cloud gsv auth setup against cloud gateway
8-up-local      pitchfork start dev-stack (wrangler dev on :8787)
9-onboard-local gsv auth setup against ws://localhost:8787/ws
10-up-device    pitchfork start device (needs node.token + gateway.url set)
```

Composites: `system-local` (1,2,3,4,8,9), `system-cloud` (1→7), `system-up` (everything + 10), `check` (CI bundle: `ci:parse-check + ci:check-workflow-nu + test-cli + test-gateway`).

Local CI bundle is named `check` (not `ci`) — bare `ci` would collide with the shared `ci:*` namespace.

## Shared lib tasks gsv consumes

mise.toml `task_config.includes` pulls 3 namespaces from joeblew999/.github at `?ref=v0.19.2`:
- `tasks/ci.toml`  → `ci:parse-check`, `ci:check-toml-tasks`, `ci:check-workflow-nu`, `ci:watch`, `ci:clean`, `ci:audit-lib-refs`
- `tasks/cf.toml`  → `cf:token-check` (precondition for `6-deploy-cloud` + `prove-all`)
- `tasks/secrets.toml` → `secrets:sync-github` (fnox → GH Actions)

Add more namespaces (bw, wrangler, prove, mobile, rust, env, fnox, mise) by appending the URL to mise.toml's includes list.

## gsv-specific gotchas

- **`test-gateway` skipped on Windows** — vitest-pool-workers + workerd hit a libuv crash during worker teardown (cloudflare/workers-sdk#5439, #7414, #10600). gsv's prod runtime is Linux Workers; Windows coverage of those tests has limited value. The task body has a `$nu.os-info.name == "windows"` early-return.
- **1-deps Windows glob bug** — nu's `path join` uses platform separator (backslash on Windows). Build glob patterns with string interpolation + final `str replace --all '\' '/'`, never `path join`.
- **`@mongodb-js/zstd` + `node-liblzma` denied** in `package.json` `aube.allowBuilds` — postinstall scripts fail in aube's content-addressable layout; not needed at runtime.
- **`.npmrc` has `node-linker=hoisted`** — required for vitest + just-bash. npm warns "Unknown project config" — harmless.
- **`RIPGIT_WASM_CC` + `CC_wasm32_unknown_unknown`** force the wasm32 cc to `zig cc` (Apple clang has no wasm target). Defined in mise.toml `[env]`.

## gsv-specific secrets (in fnox)

- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — read by `cf:token-check` and `gsv infra deploy`.
- `GSV_PASSWORD` — auto-generated on first onboard; same password used for cloud + local users.
- `GITHUB_TOKEN` — read by `ci:watch` / `ci:clean` for `gh` CLI auth.
- `FNOX_SYNC_KEYS` (in mise.toml `[env]`, not fnox itself) — list of fnox keys `secrets:sync-github` pushes to GH Actions.
