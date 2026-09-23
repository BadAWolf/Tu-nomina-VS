# Brevo database design

`database.sql` was applied to Calculadora Vigilante on 2026-09-23 after the local checks. It expects the existing `marketing-schema.sql` followed by `marketing-profile-schema.sql` and must not be reapplied to this project. The database script itself performs no network requests and creates no cron schedule. The separate `schedule.sql` defines the production scheduler; current status and operational limits are documented in `OPERACION.md`.

## Data boundary

Supabase remains authoritative for account eligibility and recorded choices. The queue exports only the contact email, category choices and consent evidence, plus internal delivery metadata. It never contains age bands, province, city, payroll, passwords, tokens or provider keys. The `personalize` boolean is consent evidence; the actual profile fields stay in Supabase. Profile changes enqueue reconciliation without putting the changed profile values in the job.

Only a dedicated Nómina Vigilante Brevo account is appropriate for the included global-suppression behavior. A native unsubscribe can clear every email category in that Brevo account. Existing provider blacklists must never be reset to false by the adapter. This draft does not offer a resubscribe or suppression-clear endpoint.

## Consent ordering without a frontend change

The existing identity `id` is assigned before the consent trigger obtains its advisory lock. Two concurrent inserts can therefore commit choices in the reverse order of their IDs. A higher ID is not proof of the latest serialized choice.

The draft adds `consent_revision`, allocated by an atomic per-user counter while holding the existing transaction advisory lock. The consent trigger reads its predecessor using that revision; `marketing_preferences` selects by revision while keeping exactly its existing columns and `security_invoker` behavior. The frontend continues to read the same view and call `save_marketing_choices` unchanged. Clients cannot supply the revision because they have only the existing column-level insert grants, and the trigger assigns it anyway.

Historical revisions are backfilled in the old ID order while writes are locked. That preserves the current displayed choice, but cannot reconstruct a race that occurred before deployment. Historical choices needing dispute resolution still require their original evidence; this script does not invent chronology.

## Durable address state and queue

`private.brevo_contacts` maps a normalized email to its user and optional provider contact ID. It has no foreign key to Auth. The mapping, persistent suppression flag and deletion tombstone survive account deletion and consent/profile cascades.

`private.brevo_outbox` holds the latest desired state for each email and monotonically increasing generation. This is a coalescing durable outbox: intermediate updates can be skipped, but an outstanding cleanup is not lost. A confirmed email change creates a distinct address job; the old address loses eligibility and managed-list memberships. The adapter never renames a provider contact through `EMAIL`. Consent recorded for the old email never authorizes the new one.

An Auth `BEFORE DELETE` trigger records cleanup before the email and consent evidence disappear. Soft deletion, confirmation, anonymity, bans and email changes also enqueue. A deleted account produces `deleted=true`, ineligible categories and suppression. The adapter removes memberships and clears owned attributes; actual provider contact deletion, if chosen, is a separate operation and must not be claimed from an adapter acknowledgment. A tombstone is not automatically purged.

Accounts without marketing history do not enter the queue. A false-only preference or ineligible account must never cause the adapter to create an absent provider contact. Reusing a suppressed/deleted email for a new Auth user does not automatically clear its suppression or tombstone.

## Service-only RPC contract

All public RPCs have default execution rights revoked and are granted only to `service_role`. Their private implementations have an explicit caller-role check, a fixed empty `search_path`, and no client/table grants. Private tables enable RLS with no client policies. The public wrappers are intentionally narrow privileged entry points; they do not accept arbitrary SQL, arbitrary attributes or list IDs. Keys remain in the server worker, never in browser code.

| RPC | Purpose |
| --- | --- |
| `brevo_claim(p_limit=20, p_lease_seconds=120)` | Claim ready rows using `FOR UPDATE SKIP LOCKED`; at most 100 rows and 30–300 second leases. Returns JSON objects. |
| `brevo_check_lease(p_email,p_generation,p_lease_token)` | Freshness check immediately before each external mutation; false if the generation changed, lease expired or ownership differs. |
| `brevo_ack(p_email,p_generation,p_lease_token,p_provider_contact_id=null)` | Acknowledge only the exact leased generation. Save an observed provider ID; any newer generation remains pending. Return false for a stale token. |
| `brevo_fail(p_email,p_generation,p_lease_token,p_error_code,p_retry_seconds=60)` | Release that exact lease after its worker has stopped external work. Store only a bounded safe error code, never response bodies, secrets or email-bearing messages. |
| `brevo_apply_opt_out(p_event_key,p_email,p_provider_contact_id=null,p_reason='unsubscribe')` | Deduplicate a trusted provider event and persist suppression. Only `unsubscribe`/`complaint` also withdraw local choices, when the address is still current. |
| `brevo_refresh(p_after_user_id=null,p_limit=100)` | Paged initial backfill and forced periodic reconciliation. Returns processed UUIDs; continue with the last UUID until empty. Requeues unchanged local state so provider changes missed by webhooks can be discovered, and handles time-driven eligibility changes such as an expired ban. |

A claimed object contains `email`, `user_id`, `generation`, `lease_token`, `lease_until`, `provider_contact_id`, `eligible`, `own_news`, `partner_offers`, `personalize`, `consent_version`, `consent_at`, `consent_revision`, `suppress_all` and `deleted`. The adapter maps snake_case choice fields to its camelCase input. Do not send queue metadata, user UUID, revision or lease to Brevo. Treat bigint values as strings if a runtime cannot preserve exact integers.

The worker must fetch and verify provider state, check the lease before mutations, run the adapter, then acknowledge only a verified result. If the desired generation changes, stop further mutations, release the old lease, and process the newest state. A contact that is already globally blocked should cause reverse local suppression; provider blocking is never interpreted as a new opt-in.

## Reverse opt-out visible in the existing UI

The receiver authenticates/validates provider notifications before calling the service RPC; a public webhook must never forward arbitrary unverified request fields using a service key. It must derive a stable event key scoped to this provider/account. The database keeps only this key, known email, reason and receipt time. Raw webhook bodies are not persisted here.

Allowed reasons are `unsubscribe`, `complaint`, `hard_bounce`, `blocked` and `deleted`. There is no opt-in event type. Unknown addresses are ignored. Nonpositive provider IDs and a conflicting known provider ID are rejected before any state changes. An accepted verified event saves its provider ID if the mapping is still empty, including when a block arrives before the first worker acknowledgment. Future claims retain that identity protection; a replacement contact at the same email cannot silently inherit the old mapping. Duplicate events leave all state unchanged. Every accepted reason suppresses outgoing delivery. Only `unsubscribe` and `complaint`, for a currently matching Auth email, also write an immutable `brevo_opt_out` event with both categories and personalization false; `marketing_preferences` immediately reflects it and the optional profile is erased. That withdrawal also works for a now-banned or unverified account. For an old email, suppression affects only that old address and does not overwrite consent for a different current email.

`hard_bounce`, `blocked` and `deleted` are technical delivery states, not evidence of the user's withdrawal. They preserve the consent ledger, displayed preferences and optional profile while the queue sends only suppressed/ineligible state. A generic observed blacklist whose cause is unknown must use `blocked`, not `unsubscribe`. Deleting a provider contact never deletes an Auth user. The worker must retain this distinction when validating and mapping provider event types.

A later user opt-in recorded through the existing frontend does not clear provider suppression. This deliberately requires a separately designed, user-initiated resubscription flow before delivery can resume. Until that exists, the frontend may show a new selected preference while delivery remains suppressed; no automatic unblock is implemented.

## Concurrency and failure limits

Per-user transaction advisory locks serialize consent revisions and desired state. Contact-row locks precede outbox-row locks for writers; claim locks only outbox rows. Auth FK/key-share locks are obtained before the advisory lock in consent insertion to avoid the common Auth deletion inversion. The existing profile editing flow can still encounter PostgreSQL deadlock/serialization errors under competing profile deletion and account operations; a worker/client must retry the entire transaction, not reuse partial results. Rollback preserves consent/outbox atomicity.

New updates retain an existing worker's lease. Expired leases are **not automatically reclaimed**: a provider API cannot enforce a database fencing token, and a timed-out HTTP request can still complete. Allowing another worker to write the same address immediately could let an old opt-in land after a new opt-out. Before operational recovery, terminate the previous worker and establish that no request remains in flight, inspect/reconcile the provider, then release the exact lease with `brevo_fail`. If that cannot be established, keep the row blocked for review. An in-flight worker may acknowledge its matching token after the nominal timeout because no second worker has been allowed to reclaim it.

Even a fresh preflight cannot make a remote API transaction atomic with Supabase. Pause campaigns during initial reconciliation and after uncertain side effects; run a fresh final audience check before any authorized send. This draft does not promise zero-latency suppression of a campaign already executing at the provider.

Retry definite failures with capped backoff and jitter, honoring provider rate limits. For uncertain writes, verify current provider state before retry; never blindly create a duplicate or unblock a contact. Monitor old leases, error codes, pending generations and mapping conflicts. No monitor is activated by this script.

## Retention

The draft retains mappings, unresolved outbox entries, suppression tombstones and deduplication keys, so it cannot silently recreate a deleted/suppressed contact. It deliberately has no automatic purge. Before deployment, choose and document the minimum retention needed for suppression evidence and cleanup; purge only completed jobs under that policy. Deleting the local tombstone or changing its user mapping must not manufacture an opt-in. The queue is private operational data, not a permanent campaign history.

## Local validation completed

The complete draft compiled and ran over the existing marketing schemas in a disposable, in-memory PostgreSQL 17.5 engine (PGlite 0.3.14), with synthetic Auth users and representative Auth functions/roles. A local harness at `tmp/brevo-db-check/verify.mjs` passed 65 checks covering client access denial, provider-source impersonation, reversed identity IDs versus consent revisions, duplicate choices, queue freshness and stale acknowledgment, expired lease behavior, native opt-out/idempotency, frontend visibility, old/new email handling, banned/unconfirmed withdrawal and deletion tombstones. Separate cases for all five provider reasons verify outgoing suppression, the canonical preferences, exact profile preservation or removal, and the consent-history event count. Identity cases verify mapping before the first acknowledgment, its inclusion in the next claim, conflicting/invalid ID rejection without side effects and unchanged state on a duplicate event. No live service was accessed by the test.

This engine has one connection, so those checks exercise state transitions and simulate reversed IDs, not actual simultaneous transactions or PostgREST transport. Multi-session locking, real Auth integration and database advisor checks remain required before deployment.

## Validation required before applying remotely

This file has not been applied to production. Validate in a disposable environment with the real baseline schema and representative Auth columns:

1. Create two overlapping consent transactions whose identity IDs are allocated out of lock order. Confirm the higher serialized revision is what the unchanged frontend view returns. Repeated identical choices must remain deduplicated.
2. Confirm anon/authenticated cannot call any Brevo RPC or read/write the private tables; an authenticated insert with `source='brevo_opt_out'` must fail. Service role can only withdraw via the provider event endpoint.
3. Confirm insert/withdraw/profile erase rollback as a unit on an injected error. Check profile-only jobs contain no demographic values.
4. Change the confirmed email while a claim exists. Both addresses must have distinct jobs, the old address becomes ineligible, and old consent cannot opt in the new one.
5. Delete or soft-delete a user with a claimed job. Mapping/tombstone survives cascade. Acknowledging the old generation cannot mark the cleanup generation complete.
6. Claim concurrently, change state, retry, acknowledge with wrong and expired tokens, and simulate a crashed worker. No two current leases may own one email; expired leases remain blocked until explicit recovery.
7. Apply duplicate, wrong-ID, unknown-address, old-email and current-email provider events. Current-email `unsubscribe`/`complaint` must make both frontend categories false and erase profile data. `hard_bounce`/`blocked`/`deleted` must suppress delivery while preserving the exact profile and consent ledger. No provider event can create consent.
8. Check exact RPC argument/result shapes against the worker/adapter and review Supabase database advisors after disposable application. Only then generate an actual migration using the CLI workflow.

References: [Supabase functions and privileges](https://supabase.com/docs/guides/database/functions), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html), [PostgreSQL SELECT and SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html), [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html). The [Supabase changelog](https://supabase.com/changelog) was checked through its HTML fallback after its Markdown endpoint failed. This design uses explicit grants and has no dependency on automatic table exposure, extension version pinning, Realtime schema writes or a self-hosted API gateway.
