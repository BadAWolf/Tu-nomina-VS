# Brevo server adapter

This directory is excluded from GitHub Pages under `admin/brevo`. It contains dependency-free adapter/worker ES modules, a Deno Edge entrypoint, database setup and tests. The production connection was deployed on 2026-09-23. See `OPERACION.md` for current configuration and verification limits, and `WORKER.md` for authenticated route contracts. The modules do not send email.

## Contract

```js
import { createBrevoAdapter, desiredFromJob } from './adapter.mjs';

const brevo = createBrevoAdapter({
  apiKey: Deno.env.get('BREVO_API_KEY'), // Node: process.env.BREVO_API_KEY
  ownListId: Number(Deno.env.get('BREVO_OWN_LIST_ID')),
  partnerListId: Number(Deno.env.get('BREVO_PARTNER_LIST_ID')),
});

const result = await brevo.reconcileContact(desiredFromJob(job), {
  signal: abortController.signal,
  expectedContactId: job.provider_contact_id,
  // Production worker must bind this to a fresh database generation/lease check.
  // It must return exactly true while this job remains current and exclusively held.
  assertCurrent: async () => isJobStillCurrent(job),
});
```

The example uses placeholders for the worker and its lease check; it is not a deployed worker. The companion `database.sql` defines the exact check as `public.brevo_check_lease(p_email, p_generation, p_lease_token)`, returning a boolean. The worker must reject RPC errors and return true only for a true result. A Node or Supabase Edge Function can import the same `.mjs` file without Node-specific imports or a package installation. `fetchImpl` can be injected for tests. The default HTTP timeout is 15 seconds per request, configurable through `timeoutMs` up to 60 seconds.

`desiredFromJob` reads only these queue fields:

| Queue field | Adapter input | Meaning |
| --- | --- | --- |
| `email` | `email` | Current canonical address, or a durable old-address cleanup job |
| `eligible` | `eligible` | Server has checked verified address, account status and matching consent |
| `own_news` | `ownNews` | Latest own-news consent |
| `partner_offers` | `partnerOffers` | Latest collaborator-offers consent |
| `personalize` | `personalize` | Latest optional personalization permission, never demographic data |
| `consent_version` | `consentVersion` | Consent text version; required for active audiences |
| `consent_at` | `consentAt` | Timestamp with explicit timezone; required for active audiences |
| `suppress_all` | `suppressAll` | Explicit durable server suppression; may only set the global block to true |

Direct inputs reject unknown fields, including `profile`. The mapper intentionally ignores queue metadata and any demographic columns. Pass the known provider mapping separately as `expectedContactId`, as the worker does. A different remote ID fails before mutation. A mapped address returning 404 can never be recreated: an active desired state raises `MAPPED_CONTACT_MISSING`; an inactive desired state completes as absent. All consent/eligibility flags must be actual booleans. Outputs contain only `{status, contactId, verified}`. `status` is `created`, `updated`, `unchanged`, `suppressed` or `absent`. `verified` describes the most recent readback, not a guarantee against subsequent changes.

An existing global email block excludes the contact from both managed lists. A missing contact is created only for an eligible, nonsuppressed opt-in. Opted-out and ineligible existing contacts are removed from these lists and their managed consent attributes are deactivated. Unrelated lists and attributes remain untouched. No path sets `emailBlacklisted:false`, changes `EMAIL`/`ext_id`, force-merges contacts, deletes a contact, or sends a message.

`ATTRIBUTE_DEFINITIONS` lists the five normal attributes to provision separately: boolean `NV_OWN`, `NV_PARTNER`, `NV_PERSONALIZE`; text `NV_CONSENT_VERSION` and `NV_CONSENT_AT`. They describe effective eligibility for this integration, not the legal consent history. That history stays in Supabase. The two list IDs must be different positive integers.

## Demographic-data boundary and erasure uncertainty

Existing notices said age and location remain in Supabase. This adapter has no capability flag to upload them. `NV_AGE_BAND`, `NV_PROVINCE_CODE` and `NV_CITY` are cleanup-only: the only outgoing value permitted for them is the empty string, and only when a previous nonempty value is observed. Age/location audience selection must happen in Supabase.

The official contact update documentation accepts text attribute values but does **not explicitly guarantee that an empty string erases a field**. The import API explicitly documents `emptyContactsAttributes:true`, but it runs an asynchronous import and introduces a separate reconciliation process; it is intentionally not used here. Do not claim erasure is proven by a successful HTTP response.

When any managed text value needs clearing, the adapter removes the contact from both managed lists in the same update, supplies only the required blank values and other changed managed attributes, then reads it back. Only missing, null or empty-string values count as cleared. If the field remains, `CLEARANCE_NOT_CONFIRMED` is thrown and the adapter does not re-add the contact to lists. This also detects a provider ignoring incorrectly provisioned attribute types.

Before enabling real-contact processing, validate this behavior using an expressly authorized synthetic contact and readback, with account automations disabled. If clearance fails, stop and resolve the provider behavior; do not add an unchecked import or delete/recreate fallback. A contact can be excluded from these lists while remediation is pending, but this is not a claim that provider data were erased.

## Failure and concurrency contract

- Every mutation is followed by a readback. Ignored consent attributes, retained profile values, wrong membership, changed identity, missing contacts, nonaccepted HTTP statuses and malformed responses are errors, not successful synchronization.
- Every mutation invokes `assertCurrent` when supplied, including restoration after clearing. Bind it in production. Never reuse an old payload to retry a failed job: claim/read its current canonical state again.
- There are no automatic API retries. Errors expose safe `code`, `operation`, `status`, `retryable`, `retryAfterSeconds`, `fields` and `mayHaveChanged`. They contain no request URLs, addresses, API keys, raw provider body or transport exception cause. The worker should log safe error fields only, never complete queue rows or request headers.
- `mayHaveChanged:true` means the provider may already have committed a write, including a timeout or failed readback. Never assume the old provider state survived.
- A newly observed native block causes one bounded suppression cleanup pass. The adapter never reverses it.
- Brevo updates have no documented revision/CAS precondition. A database preflight and an HTTP call are not one atomic transaction. The caller must serialize work per address, retain deletion/old-email tombstones, manage lease expiry safely, reject stale acknowledgements and reconcile again after concurrent changes.
- Persistent native opt-outs/complaints and deleted-contact tombstones must be checked upstream before creation. The known provider ID protects mapped addresses; a never-acknowledged/unmapped provider creation still needs the worker's uncertain-lease hold to prevent an unsafe retry.
- Webhook authentication, idempotency and reverse suppression are in `worker.mjs`/`database.sql`, not in the adapter itself. API configuration, scheduling, complete provider erasure for account deletion and campaign send gating remain operational responsibilities. A blocked contact is not a deleted contact.
- Account repurposing, sender identity, consent lists and absence of active send automations must be verified before connecting the adapter. A contact API call is not itself a campaign send, but existing account automations can react to contact/list changes.

## Documented HTTP surface

| Purpose | Call |
| --- | --- |
| Find an address | `GET /v3/contacts/{encodedEmail}?identifierType=email_id` |
| Verify the exact contact | `GET /v3/contacts/{id}?identifierType=contact_id` |
| Create, without updating or merging existing identities | `POST /v3/contacts` with `updateEnabled:false`, `forceMerge:false` |
| Change only managed attributes/lists; optionally impose a block | `PUT /v3/contacts/{id}?identifierType=contact_id` |

Credentials are sent only as the `api-key` header to the fixed HTTPS Brevo origin. Redirects are rejected. Provider setup is separate: `GET /v3/contacts/attributes` and `POST /v3/contacts/attributes/normal/{name}` can verify/provision attributes; list creation is also outside this adapter.

Official references reviewed on 2026-09-23:

- [Create a contact](https://developers.brevo.com/reference/create-contact): identifiers, duplicate handling, `updateEnabled` and `forceMerge`.
- [Update a contact](https://developers.brevo.com/reference/update-contact): `listIds`, `unlinkListIds`, pre-existing attributes, and the warning that updating a blocked contact's email resubscribes it.
- [Get contact information](https://developers.brevo.com/reference/get-contact-info): blacklist, list membership and contact identity readback.
- [Import contacts](https://developers.brevo.com/reference/import-contacts): documented `emptyContactsAttributes` semantics and asynchronous processing; not called here.
- [Create contact attributes](https://developers.brevo.com/reference/create-attribute): separate account-level attribute provisioning.
- [Supabase environment variables](https://supabase.com/docs/guides/functions/secrets): keep provider credentials in server secrets and never in the public client.

## Run the offline checks

```sh
node --test integrations/brevo/adapter.test.mjs integrations/brevo/worker.test.mjs
```

Tests use an injected in-memory provider and synthetic `.test` addresses. They do not load environment variables, use credentials or call the network. They cover selection by category, existing blocks, explicit suppression, demographic exclusion/clearance, list preservation, ignored provider updates, stale preflights, identity drift, timeout/abort, uncertain writes and sanitized failures.
