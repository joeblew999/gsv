# ADR 0001 — Port Novu providers as GSV channel/notify workers

- **Status:** Proposed
- **Date:** 2026-05-06
- **Deciders:** project owner (joeblew999)
- **Tags:** channels, adapters, notifications, novu

## Context

GSV ships with three channel workers today — `whatsapp`, `discord`, and a `test` adapter ([adapters/](../../adapters/)) — all bidirectional, each with its own Durable Object for persistent connections. The shape is defined by `ChannelWorkerInterface` ([CHANNELS.md](../../CHANNELS.md), [docs/explanation/channel-model.md](../../docs/explanation/channel-model.md)).

[Novu](https://github.com/novuhq/novu) is an MIT-licensed notification infrastructure with **75 provider integrations** under [`.src/novu/packages/providers/src/lib`](../../.src/novu/packages/providers/src/lib/) (full source clone available locally), grouped into four categories:

- **chat** (11): `chat-webhook`, `discord`, `getstream`, `grafana-on-call`, `mattermost`, `msTeams`, `rocket-chat`, `ryver`, `slack`, `whatsapp-business`, `zulip`
- **email** (19): `braze`, `brevo`, `email-webhook`, `emailjs`, `infobip`, `mailersend`, `mailgun`, `mailjet`, `mailtrap`, `mandrill`, `netcore`, `nodemailer`, `outlook365`, `plunk`, `postmark`, `resend`, `sendgrid`, `ses`, `sparkpost`
- **push** (7 + base class): `apns`, `appio`, `expo`, `fcm`, `one-signal`, `push-webhook`, `pusher-beams`, `pushpad` (`push.base-provider.ts` is the shared base, not a provider)
- **sms** (37): including `twilio`, `messagebird`, `nexmo` (Vonage), `plivo`, `sns`, `telnyx`, `sinch`, `bandwidth`, plus 30 regional providers

These would dramatically expand GSV's "reach me anywhere" surface — but Novu providers are mostly **outbound-only notifiers**, not bidirectional conversation channels. Their interfaces (`IEmailProvider`, `ISmsProvider`, `IPushProvider`, `IChatProvider` from `@novu/stateless`) are simpler than `ChannelWorkerInterface`: just `sendMessage(options)` plus capability flags.

## Decision drivers

- GSV's value proposition is **conversational reach** (the same agent, reached from anywhere). Email/SMS/push are useful as outbound notifications but mostly aren't conversational. Some chat providers (Slack, Mattermost) genuinely are.
- **Cloudflare Workers constraints**: no Node.js APIs, bundle size matters, no persistent TCP outside DOs. Novu providers that depend on `nodemailer`, raw SMTP, or Node-only SDKs cannot be ported as-is — they must be replaced with `fetch()` calls against the platform's HTTP API.
- **Maintenance cost scales with surface.** Each ported provider becomes our responsibility for upgrades, breakage, and CF compatibility regressions. 74 providers is unrealistic; <10 high-leverage ones is realistic.
- **Two channel shapes exist.** Today's `ChannelWorkerInterface` assumes bidirectional + DO-backed. Outbound-only notifiers don't need DOs and don't have inbound. The interface needs a subset variant before we can port outbound providers cleanly.
- **License hygiene.** Novu is MIT, but per-provider files should be audited (some include vendor-specific code under additional terms).

## Considered options

1. **Port everything.** All 74 providers. Rejected — unbounded maintenance, low marginal value past the first few per category.
2. **Port nothing; build per-user demand.** Status quo. Slow but disciplined. Default if this ADR isn't accepted.
3. **Selective port: outbound-only "notify" worker + a small set of bidirectional chat providers.** Recommended below.
4. **Bridge to a hosted/self-hosted Novu instance.** No port; GSV's `notify` channel proxies to Novu's API. Lowest engineering cost, but adds an external control plane outside Cloudflare and contradicts GSV's "kernel on Cloudflare" thesis. Rejected.

## Decision

**Adopt option 3, in two phases.**

### Phase 1 — one Cloudflare Worker per outbound channel

**Language: TypeScript**, same as existing channel workers ([adapters/discord/](../../adapters/discord/), [adapters/whatsapp/](../../adapters/whatsapp/)). This is forced by the Cloudflare Workers runtime — nushell (the org default for project automation per ADR 0002 and for device-local UIs per ADR 0003) cannot run on Workers; Python on Workers is experimental and has no path from Novu source; Rust→WASM gives no leverage when porting from Novu's TypeScript. TS keeps a direct line from Novu's reference implementation to our port.

**Architecture: one worker per channel.** GSV's existing pattern (verified from [adapters/](../../adapters/), [CHANNELS.md](../../CHANNELS.md), and the `channel-<name>` bundle naming in [scripts/build-cloudflare-bundles.sh](../../scripts/build-cloudflare-bundles.sh)) is one Cloudflare Worker per channel — `channel-whatsapp`, `channel-discord`, `channel-test`. Each has its own `wrangler.jsonc`, its own secrets, its own service binding into the gateway, and its own release bundle. The CHANNELS.md explanation calls out blast-radius isolation as the explicit reason. **Outbound notifiers should follow the same pattern**, not be bundled into a single multi-provider worker. So: `adapters/notify-resend/`, `adapters/notify-slack/`, `adapters/notify-twilio/`, etc. — each its own Worker with its own deploy lifecycle.

Introduce a new interface variant `OutboundChannelInterface` (subset of `ChannelWorkerInterface`: `send` + `capabilities` + `status`, no `start`/`stop`/`login`/inbound, no DO). Land it in `gateway/src/channel-interface.ts`. Each notify-* worker implements this interface as a `WorkerEntrypoint`, just as the existing channels implement `ChannelWorkerInterface`.

**Why per-provider workers, not bundled:**

- Consistency with the existing pattern (no architectural fork)
- Fault isolation — a bad release of `channel-notify-resend` can't crash `channel-notify-twilio`
- Independent deploy/rollback — each provider can ship at its own pace
- Per-worker secret management — `RESEND_API_KEY` is a secret only on `channel-notify-resend`, not exposed to other workers
- Smaller per-worker bundles — one provider's transient deps don't bloat the others
- Service-binding boundary makes provider routing in the gateway explicit and typed — `env.CHANNEL_NOTIFY_RESEND.send(...)` rather than `env.NOTIFY.send({provider: "resend", ...})`

**Costs** (worth naming):

- Adding a new provider means a new wrangler config + a new service binding in the gateway. ~10 min of boilerplate per provider; not a real problem at 9 providers.
- More workers in the CF dashboard. Acceptable — the user already has 5 (gateway, web, ripgit, channel-whatsapp, channel-discord).

**Port these providers** — with a Workers-compatibility tier based on what Novu's implementation actually depends on (verified against [`.src/novu/packages/providers/src/lib/`](../../.src/novu/packages/providers/src/lib/)):

| Provider | Novu's deps | Port approach | Why |
|---|---|---|---|
| email/`resend` | `resend` SDK only | **Translate** — Resend SDK is fetch-based, Workers-compatible | Cleanest possible first port. |
| email/`postmark` | `postmark` SDK | **Translate** if SDK is fetch-based; else rewrite | Verify before starting. |
| email/`sendgrid` | `@sendgrid/mail` + `@sendgrid/client` + `@sendgrid/eventwebhook` | **Likely rewrite** — SendGrid SDK is Node-targeted; HTTP API is well-documented | Rewrite as fetch against `https://api.sendgrid.com/v3/mail/send`. |
| email/`ses` | `nodemailer` + `@aws-sdk/client-sesv2` + Node `crypto` | **Rewrite from scratch** — Novu's port is Node-only, not portable | Implement against SES SendEmail HTTP API directly with SigV4. AWS SDK on Workers requires the v3 modular SDK with manual fetch handler injection; nodemailer cannot run on Workers at all. |
| sms/`twilio` | `twilio` SDK | **Verify then translate or rewrite** | Twilio's API is form-encoded basic-auth HTTP — trivial to call directly without the SDK. |
| sms/`messagebird` | check | likely translate | |
| sms/`sns` | `@aws-sdk/client-sns` | **Rewrite** — same SigV4 story as SES | |
| sms/`telnyx` | `telnyx` SDK | likely translate | |
| push/`fcm` (HTTP v1) | `firebase-admin` or direct | **Rewrite** — `firebase-admin` is heavy; FCM HTTP v1 is OAuth2-bearer to a documented endpoint | |
| push/`expo` | `expo-server-sdk` | **Verify** — likely fetch-based | |
| push/`one-signal` | direct REST | **Translate** | |

**Total Phase 1: 11 providers in one worker.** But the **port approach mix** is now: 4 translates, 4 rewrites, 3 needing verification. Effort is roughly 2× what "translate everything" would imply.

**Architectural detail surfaced from reading the source:** Novu providers extend a `BaseProvider` class (`packages/providers/src/lib/base.provider.ts`) that handles camelCase↔snake_case transformation and `bridgeProviderData` passthrough merging. We don't need this complexity — GSV's `OutboundChannelInterface` should pass options through verbatim. **Do not port `BaseProvider`.**

**Interface mapping** (verified from [`packages/stateless/src/lib/provider/provider.interface.ts`](../../.src/novu/packages/stateless/src/lib/provider/provider.interface.ts)):

```ts
// Novu                     →  GSV OutboundChannelInterface
IEmailProvider.sendMessage  →  send(accountId, OutboundEmailMessage)
IEmailOptions               →  { to[], subject, html, text?, from?, cc?, bcc?, replyTo?, attachments?, headers? }
ISmsOptions                 →  { to, content, from? }
IPushOptions                →  { target[], title, content, payload, overrides? }
```

These shapes are small, clean, and map directly. The `IEmailOptions` shape can become `OutboundEmailMessage` almost verbatim.

### Phase 2 — bidirectional chat adapters

Each gets its own worker (matching the existing whatsapp/discord pattern), one DO per account:

| Provider | Why | Effort |
|---|---|---|
| `slack` | Highest-value bidirectional chat; clean Events + Web API | Medium |
| `mattermost` | Open-source self-hosted equivalent of slack; webhooks | Low |
| `rocket-chat` | Same niche as mattermost, smaller install base | Low |
| `zulip` | Open-source threaded chat; very clean API | Low |
| `msTeams` | Bot Framework is heavy; defer until clear demand | High — defer |

**Total Phase 2: 4 ported now (slack, mattermost, rocket-chat, zulip), msTeams deferred.**

### Out of scope (for now)

- All 33 regional SMS providers (`africas-talking`, `kannel`, `unifonic`, `gupshup`, …) — port on demand
- Email providers backed by `nodemailer` or proprietary Node SDKs (`mailgun`, `mandrill`, `netcore`, `nodemailer`, `outlook365`, `emailjs`) — port if user requests
- `apns` direct (FCM covers iOS via APNS bridge)
- `getstream`, `ryver`, `grafana-on-call`, `chat-webhook`, `whatsapp-business` (we already have Baileys WhatsApp)
- All `*-webhook` generic providers — covered by users wiring custom webhooks themselves

## Consequences

**Positive**

- Doubles the addressable channel surface (3 → 18 across both phases) with bounded effort
- Outbound notify covers the "agent emails/texts you when X" use case, which today requires custom integration
- Phase 2 chat adapters are natural fits for GSV's bidirectional model — adds Slack reach in particular

**Negative**

- Two channel shapes (`ChannelWorkerInterface` and `OutboundChannelInterface`) means a small refactor of the gateway's channel registry and `capabilities` modelling
- Each ported provider is ongoing maintenance — vendor API breakage, CF runtime upgrades, security advisories
- Porting requires replacing every Node SDK with raw `fetch()` — Novu code is the *shape* reference, not a literal copy
- License-audit each provider file individually before committing the port

## Implementation plan

1. **Spec the interface split** — extend `gateway/src/channel-interface.ts` with `OutboundChannelInterface` (a subset of `ChannelWorkerInterface`). Update the channel registry to accept either shape. Also: clean up the vestigial `gateway/src/adapter-interface.ts` if it's truly dead, or document why both exist. PR: small, isolated.
2. **Scaffold the first notify worker: `adapters/notify-resend/`.** One worker, no DO, `wrangler.jsonc` modeled on [`adapters/discord/wrangler.jsonc`](../../adapters/discord/wrangler.jsonc). Implements `OutboundChannelInterface` as a `WorkerEntrypoint`. Service-bound from the gateway as `env.CHANNEL_NOTIFY_RESEND`. Bundle name: `channel-notify-resend`.
3. **Port providers in priority order, easiest first** — each as its own worker, mirroring step 2:
   - **Phase 1 (ship first, ~1 week):** `notify-resend` (translate) → `notify-slack` (translate, but bidirectional — DO-backed) → `notify-twilio` (translate, Twilio API is form+basic auth) → `notify-one-signal` (translate)
   - **Phase 1 (ship next, ~2-3 weeks):** `notify-postmark` → `notify-sendgrid` (rewrite vs `https://api.sendgrid.com/v3/mail/send`) → `notify-fcm` (rewrite vs FCM HTTP v1) → `notify-expo` → `notify-mattermost` (bidirectional)
   - **Phase 2 (defer, ~3-4 weeks):** `notify-ses` (SigV4 rewrite) → `notify-sns` (SigV4) → `notify-messagebird` → `notify-telnyx` → `notify-zulip` → `notify-rocket-chat`
   
   Each PR: read Novu's reference, decide translate vs. rewrite, implement, port tests, add config keys + secrets. Easy ports first so the interface is settled before tackling the SigV4 rewrites.
4. **Add config schema** — `channels.notify-<provider>.enabled`, `channels.notify-<provider>.from`, secrets per worker via worker secrets (e.g. `RESEND_API_KEY` lives only on `channel-notify-resend`).
5. **Update [scripts/build-cloudflare-bundles.sh](../../scripts/build-cloudflare-bundles.sh)** to include each new `notify-*` worker. The bundle naming convention `channel-notify-<provider>` keeps it consistent with `channel-whatsapp` / `channel-discord`.
6. **Builtin app updates** — `adapters` builtin needs to render outbound-only channels differently (no login QR, no account list per channel — just config + test-send button).

See [novu-provider-matrix.md](../novu-provider-matrix.md) for the full empirical effort/usefulness classification of all 75 Novu providers, including the rationale for which 9+6 to port and which 60 to skip.

**Note on AWS providers (`ses`, `sns`):** SigV4 signing on Cloudflare Workers requires the AWS SDK v3 modular packages (`@aws-sdk/client-sesv2`, `@aws-sdk/client-sns`) with `requestHandler` overridden to use the Workers `fetch`. Verified: Cloudflare publishes a [Workers AWS SDK guide](https://developers.cloudflare.com/workers/tutorials/aws-sdk-v3-on-workers/) — it's known-working but adds bundle size. Worth deferring SES/SNS until after Phase 1 has shipped at least one easy port and the interface is proven.

## Open questions

- Does the gateway's `capabilities` model already accommodate "outbound-only"? If yes, the interface split is cleaner than expected.
- Should the `notify` worker be one worker hosting all providers, or one worker per provider? One worker = smaller deploy surface but bigger bundle. Decision: **one worker** until bundle size is a real problem.
- Do we want a Novu-compatibility shim (`/v1/events/trigger` HTTP endpoint) so Novu users can point existing client SDKs at GSV? Probably not — out of scope for this ADR.

## References

- [Novu providers source](https://github.com/novuhq/novu/tree/next/packages/providers/src/lib)
- [Novu `@novu/stateless` interfaces](https://github.com/novuhq/novu/tree/next/packages/stateless)
- GSV channel interface: [docs/explanation/channel-model.md](../../docs/explanation/channel-model.md)
- GSV channel architecture: [CHANNELS.md](../../CHANNELS.md)
- Existing adapter examples: [adapters/discord/](../../adapters/discord/), [adapters/whatsapp/](../../adapters/whatsapp/), [adapters/test/](../../adapters/test/)
- Repo agent guide: [AGENTS.md](../../AGENTS.md)
