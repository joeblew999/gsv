# Novu provider matrix — easy/hard × useful/not

Empirical classification of all 75 Novu providers, derived by greping every import statement across [`.src/novu/packages/providers/src/lib/`](../.src/novu/packages/providers/src/lib/). Decision-support input for [ADR 0001](adrs/0001-port-novu-adapters.md).

## TL;DR — what to actually port

The recommended Phase 1 set is **9 providers**, prioritized by `useful × (1/effort)`:

| Tier | Providers | Total effort | Why this set |
|---|---|---|---|
| **Ship first** | `resend`, `slack`, `twilio`, `one-signal` | ~1 week | Mainstream pick in their category, easiest ports, cover email/chat/sms/push baseline |
| **Ship next** | `postmark`, `sendgrid`, `fcm`, `expo`, `mattermost` | ~2-3 weeks | Fill in transactional email, Android/iOS push, self-hosted chat |
| **Phase 2 (defer)** | `ses`, `sns`, `messagebird`, `telnyx`, `zulip`, `rocket-chat` | ~3-4 weeks | AWS-native + international SMS + niche chat — only if user demand surfaces |

**Total useful providers ≈ 15.** The other 60 are skip-or-defer.

## Methodology

### Effort axis (port cost)

Read every provider's `import` statements. Classification:

- **TRIVIAL** — no third-party imports; uses raw `fetch` already. ~15 min/provider.
- **EASY** — only `axios` (+ optional `crypto` for webhook signature verification). Mechanical `axios.post → fetch` translation. ~30-60 min/provider.
- **MEDIUM** — uses a third-party SDK that is fetch-based or has a clean HTTP fallback. Verify the SDK runs on Workers; if yes translate, if no rewrite against the documented HTTP API. ~2-4 hours/provider.
- **HARD** — uses Node-only deps (`nodemailer`, `firebase-admin`, `@aws-sdk/*`, `tls`, `proxy-agent`, native HTTP/2 clients). Cannot run on Workers; full rewrite against vendor HTTP API required. SES/SNS additionally need SigV4 signing. ~1-2 days/provider.
- **IMPOSSIBLE** — fundamentally incompatible with Workers (raw SMTP via `tls` socket). Either skip or wait for Cloudflare TCP socket bindings to mature. Examples: `nodemailer`, `outlook365`, `emailjs`.

### Usefulness axis (value to GSV)

GSV is a **personal cloud OS for one user**, not a multi-tenant SaaS. The product thesis is "one agent reachable everywhere I am". This biases hard toward the few channels a single person actually uses, against long-tail regional providers.

- **HIGH** — mainstream pick in its category, broad consumer/dev recognition, would meaningfully expand GSV's reach.
- **MEDIUM** — strong fit for a specific ecosystem (AWS-native, RN apps, self-hosted, international).
- **LOW** — covered better by something else, or serves a niche GSV doesn't target.
- **SKIP** — generic webhook stubs (any agent can `curl` directly), redundant with what GSV already has, or Workers-incompatible-by-design.

## Per-category matrix

### Chat (11 providers)

| Provider | Imports | Effort | Useful | Recommendation |
|---|---|---|---|---|
| `slack` | axios | EASY | HIGH | **Phase 1 — bidirectional adapter, mirror discord pattern** |
| `mattermost` | axios | EASY | HIGH | **Phase 1 — open-source slack alternative, big in self-hosted** |
| `zulip` | axios | EASY | MEDIUM | Phase 2 — niche but loyal users; clean API |
| `rocket-chat` | axios | EASY | MEDIUM | Phase 2 — same niche as mattermost |
| `discord` | axios | EASY | — | **Skip — GSV already has its own discord adapter** |
| `whatsapp-business` | axios | EASY | — | **Skip — GSV already has whatsapp via Baileys** |
| `msTeams` | axios | EASY | LOW | Skip — Bot Framework is heavy, corporate-only, rare for personal use |
| `getstream` | axios | EASY | SKIP | Skip — chat-as-a-service competitor; useless to GSV |
| `grafana-on-call` | axios+uuid | EASY | SKIP | Skip — alerting-tool-specific |
| `ryver` | axios | EASY | SKIP | Skip — declining product |
| `chat-webhook` | axios+crypto | EASY | SKIP | Skip — generic outbound webhook, agents can curl |

### Email (19 providers)

| Provider | Imports | Effort | Useful | Recommendation |
|---|---|---|---|---|
| `resend` | resend SDK | MEDIUM | HIGH | **Phase 1 — Resend SDK is fetch-based, easiest first port** |
| `postmark` | postmark SDK | MEDIUM | HIGH | **Phase 1 — transactional gold standard** |
| `sendgrid` | @sendgrid/* (Node) | HARD | HIGH | **Phase 1 — rewrite against `api.sendgrid.com/v3/mail/send`** |
| `ses` | nodemailer + aws-sdk + crypto | HARD | MEDIUM | Phase 2 — rewrite with SigV4; defer until AWS users ask |
| `mailgun` | mailgun.js + form-data | HARD | MEDIUM | Phase 2 — rewrite with native FormData |
| `mandrill` | @mailchimp/mailchimp_transactional | MEDIUM | LOW | Skip unless Mailchimp shop |
| `mailtrap` | mailtrap SDK | MEDIUM | LOW | Skip — testing-only provider |
| `brevo` | axios | EASY | LOW | Skip — long-tail European; Resend covers the niche |
| `mailjet` | node-mailjet | MEDIUM | LOW | Skip |
| `mailersend` | mailersend SDK | MEDIUM | LOW | Skip |
| `sparkpost` | axios+crypto | EASY | LOW | Skip — declining |
| `netcore` | axios | EASY | LOW | Skip — regional |
| `infobip` (email) | @infobip-api/sdk | MEDIUM | LOW | Skip |
| `plunk` | @plunk/node | MEDIUM | LOW | Skip |
| `braze` | braze-api | MEDIUM | LOW | Skip — marketing-automation focus |
| `nodemailer` | nodemailer + tls | IMPOSSIBLE | LOW | **Skip — raw SMTP not viable on Workers** |
| `outlook365` | nodemailer | IMPOSSIBLE | LOW | Skip — SMTP only |
| `emailjs` | emailjs (SMTP) | IMPOSSIBLE | LOW | Skip — SMTP only |
| `email-webhook` | axios+crypto | EASY | SKIP | Skip — generic outbound webhook |

### Push (8 entries; 7 providers + 1 base class)

| Provider | Imports | Effort | Useful | Recommendation |
|---|---|---|---|---|
| `fcm` | firebase-admin + crypto | HARD | HIGH | **Phase 1 — rewrite against FCM HTTP v1; covers Android + iOS-via-APNS** |
| `expo` | expo-server-sdk | MEDIUM | HIGH | **Phase 1 — fetch-based; standard for RN apps** |
| `one-signal` | axios | EASY | HIGH | **Phase 1 — easiest of the lot, multi-platform** |
| `apns` | @parse/node-apn (HTTP/2 + cert auth) | HARD | LOW | Skip — FCM bridges to APNS, redundant |
| `pusher-beams` | axios | EASY | LOW | Skip — small market share |
| `pushpad` | pushpad SDK | MEDIUM | LOW | Skip — niche web push |
| `appio` | axios | EASY | LOW | Skip — declining |
| `push-webhook` | axios+crypto | EASY | SKIP | Skip — generic outbound webhook |

### SMS (37 providers)

| Provider | Imports | Effort | Useful | Recommendation |
|---|---|---|---|---|
| `twilio` | twilio SDK (Node) | MEDIUM | HIGH | **Phase 1 — rewrite as direct fetch (Twilio API is form+basic auth, trivial)** |
| `messagebird` | messagebird SDK | MEDIUM | MEDIUM | Phase 2 — international SMS leader |
| `telnyx` | telnyx SDK | MEDIUM | MEDIUM | Phase 2 — developer-friendly, growing |
| `sns` | @aws-sdk/client-sns | HARD | MEDIUM | Phase 2 — rewrite with SigV4 |
| `nexmo` (Vonage) | @vonage/server-sdk | HARD | MEDIUM | Phase 2 — declining but still big |
| `plivo` | plivo SDK | MEDIUM | LOW | Skip |
| `sinch` | axios | EASY | LOW | Skip — international, niche |
| `bandwidth` | @bandwidth/messaging | MEDIUM | LOW | Skip — US-only |
| `azure-sms` | @azure/communication-sms | MEDIUM | LOW | Skip — Azure-native only |
| `ring-central` | @ringcentral/sdk | MEDIUM | LOW | Skip — corporate phone-system focus |
| `africas-talking` | africastalking SDK | MEDIUM | LOW | Skip — regional (Africa) |
| `infobip` (sms) | @infobip-api/sdk | MEDIUM | LOW | Skip — international, regional |
| `clickatell` | axios | EASY | LOW | Skip — regional |
| `cm-telecom` | axios | EASY | LOW | Skip — Europe-focused |
| `gupshup` | axios | EASY | LOW | Skip — India-focused |
| `clicksend` | axios | EASY | LOW | Skip |
| `simpletexting` | axios | EASY | LOW | Skip — US-only marketing SMS |
| `sendchamp` | axios | EASY | LOW | Skip — Africa |
| `sms-central` | axios | EASY | LOW | Skip — AU/NZ |
| `forty-six-elks` | axios | EASY | LOW | Skip — Nordic |
| `smsmode` | axios | EASY | LOW | Skip — France |
| `unifonic` | axios+qs | EASY | LOW | Skip — Middle East |
| `maqsam` | axios+date-fns | EASY | LOW | Skip — Middle East |
| `burst-sms` | axios+qs | EASY | LOW | Skip — AU |
| `bulk-sms` | axios | EASY | LOW | Skip |
| `mobishastra` | axios | EASY | LOW | Skip — India |
| `imedia` | axios | EASY | LOW | Skip |
| `kannel` | axios | EASY | LOW | Skip — open-source SMS gateway, niche |
| `eazy-sms` | axios | EASY | LOW | Skip |
| `isend-sms` | axios | EASY | LOW | Skip |
| `isendpro-sms` | axios | EASY | LOW | Skip — France |
| `afro-sms` | axios | EASY | LOW | Skip — Ethiopia |
| `firetext` | (none — raw fetch) | TRIVIAL | LOW | Skip — UK only |
| `termii` | (none — raw fetch) | TRIVIAL | LOW | Skip — Africa |
| `sms77` | sms77-client | MEDIUM | LOW | Skip — Germany |
| `brevo-sms` | proxy-agent | HARD | LOW | Skip — proxy-agent is Node-only |
| `generic-sms` | axios | EASY | LOW | Skip — generic webhook |

## Cross-cutting "skip everything" lists

These groups can be dismissed without per-provider analysis:

- **All `*-webhook` providers** (4 of them): generic outbound HTTP — agents can curl directly.
- **All providers Novu we've already implemented** (2): `discord`, `whatsapp-business`. GSV has its own.
- **All SMTP-based email** (3): `nodemailer`, `outlook365`, `emailjs`. Workers-incompatible by design.
- **All 33 regional SMS providers**: skip until a user actually requests one. Adding one later is a self-contained ~30 min port for axios-based ones.

## Effort summary

If we shipped **only the recommended 9** (Phase 1), total port effort is roughly:

| Effort tier | Phase 1 count | Per-provider | Subtotal |
|---|---|---|---|
| EASY | 2 (`slack`, `one-signal`) | 0.5 days | 1 day |
| MEDIUM | 4 (`resend`, `postmark`, `expo`, `twilio`) | 1 day | 4 days |
| HARD | 3 (`sendgrid`, `fcm`, `mattermost`*) | 2 days | 6 days |
| **Total** | **9** | — | **~11 working days = ~3 weeks** |

\* `mattermost` is axios so technically EASY, but bidirectional adapter scaffolding (mirroring the discord DO pattern) lifts it to MEDIUM-HARD effort.

Phase 2 (the next 6: `ses`, `sns`, `messagebird`, `telnyx`, `zulip`, `rocket-chat`) would add another ~3 weeks. The remaining 60 providers stay skipped indefinitely.

## What this means for ADR 0001

Updates already applied to the ADR based on this analysis:

- **9 providers in Phase 1, 6 in Phase 2** (was: 11 in Phase 1)
- **One worker per channel** (was: one bundled `adapters/notify/` worker hosting all providers behind internal routing). Per-channel-per-worker is the existing GSV pattern (`channel-whatsapp`, `channel-discord` — see [CHANNELS.md](../CHANNELS.md)). New workers: `channel-notify-resend`, `channel-notify-slack`, `channel-notify-twilio`, `channel-notify-one-signal`, etc.
- **Rewrite-vs-translate split** corrected to match what `import` statements actually show — `ses`/`sns`/`fcm`/`sendgrid` are rewrites, not translates.
- This matrix is the source of truth for any "should we port X?" question.
