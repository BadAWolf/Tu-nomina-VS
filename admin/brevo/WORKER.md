# Brevo worker and Edge entrypoint

Production activation: see `OPERACION.md`. The setup checklist below documents deployment order; it is not a statement that the current connection remains undeployed. The hosted Deno handler, PostgREST permissions and provider contact clearance have now been checked.

`worker.mjs` exports `createBrevoWorker(config, dependencies?)`, a standard Web Request → Response handler. `edge/index.ts` reads server environment variables and passes the handler to `Deno.serve`. Neither file is part of the public website or contains a real credential. The JavaScript core is exercised in Node with injected mock transports. The compiled handler was also verified in the hosted Supabase runtime with authenticated and unauthorized requests and the initial authorized subscriber synchronization.

## Routes and authentication

The planned function name is `brevo-marketing`. Its public URLs would be:

- `https://PROJECT_REF.supabase.co/functions/v1/brevo-marketing/sync`
- `https://PROJECT_REF.supabase.co/functions/v1/brevo-marketing/webhook`

Both require POST and `Content-Type: application/json`. Each accepts at most 16,384 body bytes, enforced on the stream as well as Content-Length. They have distinct bearer secrets, with at least 32 characters each. Use independently generated high-entropy tokens; length alone does not make a token secure. A worker token cannot authenticate a webhook, and a webhook token cannot run synchronization. User/anonymous JWTs are not accepted.

`verify_jwt = false` is intentional in `edge/config.example.toml`: gateway JWT authentication is replaced by route-specific authentication in the handler. Authentication completes before the body is read or any database/provider call occurs. Token digests use SHA-256; comparison uses native Web Crypto HMAC verification over the fixed-length digests, avoiding a JavaScript string/prefix comparison. Missing/wrong tokens return 401. No permissive CORS headers are provided.

Required server variables:

| Name | Purpose |
| --- | --- |
| `BREVO_API_KEY` | Contact API access only in application code; never log it |
| `BREVO_OWN_LIST_ID` | Root-designated own-news list, currently 3 |
| `BREVO_PARTNER_LIST_ID` | Root-designated collaborator list, currently 4 |
| `SUPABASE_URL` | Exact project HTTPS origin; accepted host is one label under `supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-only calls to the agreed public RPC wrappers |
| `BREVO_WORKER_TOKEN` | Secret bearer for the sync route |
| `BREVO_WEBHOOK_TOKEN` | Different secret bearer for Brevo webhook delivery |

The strict origin check intentionally excludes custom Supabase domains. Supporting one requires a reviewed code/config change, not a URL in an incoming request. All outgoing fetches reject redirects. Request bodies cannot choose origins, RPC names, endpoints or send operations.

## Sync contract

The request body is `{}` or `{"limit":1}`; the maximum requested limit is 5. The handler claims one row just before processing it using `brevo_claim(p_limit:1,p_lease_seconds:300)`. It stops claiming additional rows after a 45-second soft run budget; a current job may finish after that budget. Individual network calls have a 10-second timeout. Claims never sit behind other contacts in a batch.

Never-exported inactive choices are acknowledged locally after a fresh lease check, without disclosing their email address in a provider lookup. For each exported or newly eligible row it:

1. Validates the lease/identity fields and maps canonical consent without demographic data.
2. Passes the mapped provider ID and `brevo_check_lease` callback to the adapter. Each external mutation checks the lease again.
3. Persists a newly observed native block using `brevo_apply_opt_out(...,p_reason:'blocked')`. A missing mapped active contact becomes technical `deleted` suppression instead of being recreated. These delivery states do not invent user withdrawal.
4. Checks generation/lease again before `brevo_ack`. Superseded work is never acknowledged by this worker.
5. Releases a safe failed/stale job only through `brevo_fail` with its exact email/generation/token. Unknown or timed-out provider mutations, identity replacements, malformed claim responses and uncertain acknowledgements retain the lease for operational review. They are not retried automatically.

The companion database never automatically reclaims an expired lease. Before an operator releases one, confirm the old worker has ended and inspect the provider's current state. Do not blindly release a lease because its deadline passed. A process can be interrupted after a provider write committed but before the database knows it.

Successful responses contain counts only. Partial/stale/manual-review results have `ok:false`; 409 indicates stale work or required review, and 503 indicates a safe retry was scheduled or an upstream operation failed. Do not treat every HTTP response as completed synchronization. Raw queue rows, addresses, tokens and provider bodies are never returned or logged by the handler.

Use the exact database signatures in `database.sql`. In particular, `brevo_refresh(p_after_user_id,p_limit)` is an owner/service operation outside these HTTP routes; it now force-enqueues unchanged canonical state so a periodic reconciliation can discover missed native blocks. Page through all relevant users and invoke `/sync` until the queue drains. Creating the schedule is a separate activation action; this preparation does not install one.

## Webhook contract

Create a marketing email webhook only after the deployed handler has passed its authentication checks. Configure unbatched delivery (`batched:false`), a bearer token equal to `BREVO_WEBHOOK_TOKEN`, and configuration event names:

```json
{
  "type": "marketing",
  "batched": false,
  "events": ["unsubscribed", "contactDeleted", "hardBounce", "spam"],
  "url": "https://PROJECT_REF.supabase.co/functions/v1/brevo-marketing/webhook",
  "auth": { "type": "bearer", "token": "SERVER_SECRET_PLACEHOLDER" }
}
```

The delivered payload uses different event names. Only these are accepted:

| Native payload event | Required fresh Brevo state | Database reason | Canonical user choice |
| --- | --- | --- | --- |
| `unsubscribe` | Contact currently email-blocklisted | `unsubscribe` | Withdraw both email categories and personalization |
| `spam` | Contact currently email-blocklisted | `complaint` | Withdraw both email categories and personalization |
| `hard_bounce` | Contact currently email-blocklisted | `hard_bounce` | Preserve choice; impose delivery suppression |
| `contact_deleted` | Address currently returns 404 | `deleted` | Preserve choice; prevent recreation |

The handler accepts numeric UTC seconds in `ts_event`, falling back to `ts`. Historical events are allowed because delivery can be delayed; timestamps more than five minutes in the future are rejected. Human-readable dates are not parsed to guess a timezone. The event key hashes event type, canonical address, occurrence timestamp, webhook ID and campaign ID. Display timestamps or retry delivery metadata do not change it. Database event keys make retries idempotent.

Payload `id` is documented as the webhook ID, **not the contact ID**. For active contacts, the provider contact ID comes from a fresh `GET /v3/contacts/{encodedEmail}?identifierType=email_id`. The database checks it against its existing mapping. For a confirmed deletion, it is null because the provider no longer returns the record. No webhook performs provider writes or creates a user/contact.

An unblocked contact, an absent contact for a non-deletion event, a deletion notification for a present contact, unknown event types, batched input or ambiguous shapes return a non-success status without changing local consent. This conservative behavior can require manual review if provider state propagation is delayed. Do not reinterpret ambiguous events as opt-ins or indiscriminately clear a block. Unknown local contacts return an explicit ignored result from the RPC. Duplicate events return the database's duplicate result.

## Scope boundaries before activation

- Only the repurposed, exclusively Calculadora Vigilante account is suitable for this integration's global delivery suppression.
- Confirm old send automations are inactive. Contact/list API changes can trigger existing account workflows even though this code has no send endpoints.
- Provision and verify only the two designated lists and the five `NV_*` attributes exported by the adapter. Keep emails and optional consent flags separate from demographic data, which remain in Supabase.
- Review/apply the database schema and permissions separately. No live migration was performed by the worker implementation task.
- Deploy `edge/index.ts` together with `worker.mjs` and `adapter.mjs`, preserving their relative import paths. Merge the function configuration stanza into the actual deployment config and load secrets through the server secret manager, not a committed `.env` file.
- Verify unauthorized requests produce 401 with zero database/provider work before registering the webhook or scheduling sync.
- Validate contact clearance with an explicitly authorized synthetic provider record before transferring real contacts. Mock tests do not prove Brevo's undocumented blank-attribute behavior.
- Bootstrap and periodically refresh the queue, activate the webhook, then run a controlled sync and check its aggregate results. Do not send campaigns during setup.
- **Full provider erasure is not implemented by this worker.** A deleted local account is excluded and suppressed, but the contact adapter does not call `DELETE /contacts`. Complete erasure must be handled by the reviewed operational deletion procedure before claiming an account has been erased from Brevo. Delivery suppression is not erasure.
- Block campaign execution whenever required withdrawals, uncertain jobs, failed clearance or deletion requests remain unresolved. Campaign preparation/sending is outside this implementation.

## Offline verification and official sources

```sh
node --test integrations/brevo/adapter.test.mjs integrations/brevo/worker.test.mjs
```

The tests supply all transport responses in memory, use synthetic `.test` addresses and keys, and do not read secret environment variables. They cover unauthorized zero-I/O requests, streaming size bounds, scoped authentication, stale leases/retries, mapped deletion and replacement IDs, durable native blocks, reverse-event validation, duplicate delivery and error sanitization.

- [Brevo marketing webhooks](https://developers.brevo.com/docs/marketing-webhooks): exact native payload fields and event names.
- [Create a webhook](https://developers.brevo.com/reference/create-webhook): configuration event names and unbatched settings.
- [Secure webhook calls](https://developers.brevo.com/docs/secured-webhooks): bearer-token delivery authentication.
- [Get contact information](https://developers.brevo.com/reference/get-contact-info): fresh provider blacklist and identity checks.
- [Securing Supabase Edge Functions](https://supabase.com/docs/guides/functions/auth): disabling gateway JWT checks requires the handler's own authentication.
