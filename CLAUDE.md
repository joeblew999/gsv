# CLAUDE.md — joeblew999 branch

Operational brief for any AI agent working on this branch. Keep mise, pitchfork, mise-tasks, and CI all working as one coherent system.

## Hard rules

1. **Run `mise run ci` locally BEFORE every push.** SSOT means: if local passes, CI passes. Don't push without verifying locally.
2. **Workflow YAML calls one mise task per job.** Never enumerate steps. To change what CI does, edit the task file in `mise-tasks/`, not `.github/workflows/mise.yml`.
3. **Additive only — do not modify upstream's `scripts/` or source code.** All workarounds for upstream's macOS/Windows gaps live in `.mise-bin/` shims or env overrides in `mise.toml`.
4. **Same mise.toml on local and CI.** No selective tool installs. `mise install` brings up identical state on every machine.

## Layout

| | What |
|---|---|
| [mise.toml](mise.toml) | Tools, env, includes (shared task lib + local `mise-tasks/`) |
| [pitchfork.toml](pitchfork.toml) | Long-lived daemons (`dev-stack`, `device`) |
| [mise-tasks/](mise-tasks/) | nu file tasks. One task per file. Each has `#MISE description=` + optional `#MISE depends=[...]` |
| [.mise-bin/](.mise-bin/) | Local shims — `flock` (no-op for macOS) + `zig-cc` (target translator) |
| [.github/workflows/mise.yml](.github/workflows/mise.yml) | CI — calls `mise run ci` per OS |
| [.github/workflows/mise-upgrade.yml](.github/workflows/mise-upgrade.yml) | Weekly tool-version bumps via `mise run mise-upgrade` → PR |
| [renovate.json](renovate.json) | Renovate bot config (alternative to mise-upgrade workflow) |
| upstream `scripts/` | Bash — **do not touch**. Used by wrangler `[build]` hooks; `.mise-bin/flock` makes them work on macOS. |

## Numbered orchestration tasks (the workflow path)

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

Composites: `system-local` (1,2,3,4,8,9), `system-cloud` (1→7), `system-up` (everything + 10).

## CI tooling

- **`mise run ci`** — same task local + CI. Runs `ci-parse-check` + `test-cli` + `test-gateway` via `#MISE depends`. **gsv-specific** (lives here).
- **`mise run ci:watch`** — streams per-job and per-step CI transitions via gh CLI. **From shared lib** (`joeblew999/.github` v0.14.0+).
- **`mise run ci:clean`** — deletes failed/cancelled runs. **From shared lib.**
- **`mise run mise:upgrade [--dry-run]`** — bumps `mise.toml` pins via `mise upgrade --bump --local`. **From shared lib.** Workflow runs it weekly + opens a PR.

## Known gotchas — keep in mind

- **Workflow cache key must be custom.** jdx/mise-action#382 has a prefix-match bug + missing return-on-hit. mise.yml uses `cache_key: mise-${{ github.job }}-${{ matrix.os }}-${{ hashFiles('mise.toml') }}` to dodge it. Don't drop this.
- **`.npmrc` has `node-linker=hoisted`.** Required for vitest + just-bash + similar packages that assume flat node_modules. npm warns "Unknown project config" — harmless, ignore.
- **`@mongodb-js/zstd` is denied** in `package.json` `aube.allowBuilds`. Its `bash etc/install-zstd.sh` postinstall fails in aube's content-addressable layout. We don't use the native binary at runtime.
- **`node-liblzma` is denied** for the same reason — gyp build fails, not needed at runtime.
- **`RIPGIT_WASM_CC=zig-cc`** in `[env]` forces ripgit's `wasm-cc` shim to use zig instead of Apple clang (which has no wasm32 target).
- **`mise upgrade --bump` without `--local`** leaks into your global `~/.config/mise/config.toml`. Always pass `--local` (the `mise-upgrade` task already does).

## Secrets

- **fnox** is the local secret store (macOS keychain / Windows Credential Manager / Linux secret-service).
- **GITHUB_TOKEN** in fnox is read by `ci-watch` / `ci-clean` for gh CLI auth.
- **CLOUDFLARE_API_TOKEN** + **CLOUDFLARE_ACCOUNT_ID** in fnox are read by `cf:token-check` (shared lib) and `infra-deploy`.
- **GSV_PASSWORD** in fnox is auto-generated on first onboard; same password used for cloud + local users.
- `mise run secrets:sync-github` (from shared lib) pushes fnox keys listed in `FNOX_SYNC_KEYS` (mise.toml [env]) to GitHub Actions secrets.

## When you change something

1. Identify which layer you touched: mise.toml, mise-tasks/*, pitchfork.toml, workflow YAML, or shims.
2. Run `mise run ci-parse-check` — catches nu syntax errors fast.
3. Run `mise run ci` — full validation locally.
4. If both green, push.
5. Use `mise run ci-watch` to see CI status; `mise run ci-clean` to clean stale runs after.

## Don'ts

- Don't enumerate mise tasks in workflow YAML — single source of truth lives in `mise-tasks/<name>`.
- Don't mix backends — pinning tools as `aqua:foo/bar` AND `github:foo/bar` creates two installs of the same tool.
- Don't push without local `mise run ci` passing.
- Don't modify upstream's `scripts/`, `gateway/src/`, `web/src/`, etc. Additions go in mise-tasks, .mise-bin, notes/, .src/.
- Don't run `mise upgrade --bump` without `--local` — pollutes global config.
- Don't assume "works on macOS" means "works on Windows" — CI matrix includes windows-latest for a reason.
