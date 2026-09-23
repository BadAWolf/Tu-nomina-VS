import { BrevoAdapterError, createBrevoAdapter, desiredFromJob } from './adapter.mjs';

export const FUNCTION_NAME = 'brevo-marketing';
export const MAX_BODY_BYTES = 16 * 1024;
const BREVO_API = 'https://api.brevo.com/v3';
const RPC_NAMES = new Set(['brevo_claim', 'brevo_check_lease', 'brevo_ack', 'brevo_fail', 'brevo_apply_opt_out']);
const EVENTS = Object.freeze({ unsubscribe: 'unsubscribe', contact_deleted: 'deleted', hard_bounce: 'hard_bounce', spam: 'complaint' });
const SAFE_STATUSES = new Set(['created', 'updated', 'unchanged', 'suppressed', 'absent']);
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);

class WorkerError extends Error {
  constructor(code, status = 503, { uncertain = false } = {}) {
    super(code);
    this.name = 'BrevoWorkerError';
    Object.assign(this, { code, status, uncertain });
  }
}
const fail = (code, status, details) => { throw new WorkerError(code, status, details); };

function email(value) {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) fail('INVALID_EMAIL', 400);
  return value.toLowerCase();
}

function validateConfig(config) {
  if (!object(config)) fail('INVALID_CONFIGURATION', 500);
  for (const field of ['apiKey', 'serviceRoleKey', 'workerToken', 'webhookToken']) {
    const value = config[field];
    if (typeof value !== 'string' || !value.trim() || /\s/u.test(value)) fail('INVALID_CONFIGURATION', 500);
  }
  for (const key of ['workerToken', 'webhookToken']) {
    if (config[key].length < 32 || config[key].length > 512) fail('INVALID_CONFIGURATION', 500);
  }
  if (new Set([config.apiKey, config.serviceRoleKey, config.workerToken, config.webhookToken]).size !== 4) fail('TOKENS_MUST_BE_DISTINCT', 500);
  if (!positive(config.ownListId) || !positive(config.partnerListId) || config.ownListId === config.partnerListId) fail('INVALID_CONFIGURATION', 500);
  let url;
  try { url = new URL(config.supabaseUrl); } catch { fail('INVALID_CONFIGURATION', 500); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') fail('INVALID_SUPABASE_ORIGIN', 500);
  return { ...config, supabaseUrl: url.origin };
}

/** No body is read until route-specific bearer authentication has succeeded. */
async function readBody(request) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) fail('BODY_TOO_LARGE', 413);
  if (!/^application\/json(?:\s*;.*)?$/iu.test(request.headers.get('content-type') ?? '')) fail('JSON_REQUIRED', 415);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        fail('BODY_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    fail('BODY_READ_FAILED', 400);
  } finally { reader.releaseLock(); }
  if (!size) return {};
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('INVALID_JSON', 400); }
}

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

function validateJob(job) {
  if (!object(job) || !positive(job.generation) || !uuid(job.lease_token)
    || typeof job.lease_until !== 'string' || !Number.isFinite(Date.parse(job.lease_until))
    || (job.provider_contact_id !== null && !positive(job.provider_contact_id))) fail('INVALID_CLAIM_RESPONSE', 503);
  email(job.email);
  return { p_email: job.email, p_generation: job.generation, p_lease_token: job.lease_token };
}

function validateEvent(payload, now) {
  if (!object(payload)) fail('UNBATCHED_EVENT_REQUIRED', 400);
  if (typeof payload.event !== 'string' || !Object.hasOwn(EVENTS, payload.event)) fail('UNSUPPORTED_EVENT', 422);
  const eventEmail = email(payload.email);
  // Payload `id` identifies the webhook, not the Brevo contact. Never use it as one.
  const timestamp = payload.ts_event ?? payload.ts;
  if (!positive(timestamp) || timestamp > Math.floor(now() / 1000) + 300) fail('INVALID_EVENT_TIME', 400);
  const identifier = value => {
    if (value === undefined || value === null) return null;
    if (positive(value)) return String(value);
    if (typeof value === 'string' && /^[0-9]{1,30}$/u.test(value)) return value;
    fail('INVALID_EVENT_IDENTIFIER', 400);
  };
  return { event: payload.event, email: eventEmail, timestamp,
    webhookId: identifier(payload.id), campaignId: identifier(payload.camp_id), reason: EVENTS[payload.event] };
}

/**
 * Server-only Request -> Response handler. All I/O can be injected for offline tests.
 * No scheduling, deployment, campaign endpoints, logs or implicit opt-ins.
 */
export function createBrevoWorker(configuration, { fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto, now = Date.now, timeoutMs = 10000,
  maxRunMs = 45000, reconcileImpl } = {}) {
  const config = validateConfig(configuration);
  if (typeof fetchImpl !== 'function' || !cryptoImpl?.subtle || typeof now !== 'function'
    || !positive(timeoutMs) || timeoutMs > 15000 || !positive(maxRunMs) || maxRunMs > 60000
    || (reconcileImpl !== undefined && typeof reconcileImpl !== 'function')) fail('INVALID_CONFIGURATION', 500);
  const digest = async value => new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', encoder.encode(value)));
  // Native MAC verification compares token digests without a JavaScript equality
  // loop. The comparison key is not an authentication secret; bearer tokens are.
  const comparisonKey = cryptoImpl.subtle.importKey('raw', encoder.encode('brevo-token-comparison-v1'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const tokenProof = async token => cryptoImpl.subtle.sign('HMAC', await comparisonKey, await digest(token));
  const workerProof = tokenProof(config.workerToken), webhookProof = tokenProof(config.webhookToken);
  const adapter = createBrevoAdapter({ apiKey: config.apiKey, ownListId: config.ownListId,
    partnerListId: config.partnerListId, fetchImpl, timeoutMs });
  const reconcile = reconcileImpl ?? adapter.reconcileContact;

  async function authenticated(request, expectedProof) {
    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer ([^\s]{1,512})$/iu.exec(header);
    if (!match) return false;
    return cryptoImpl.subtle.verify('HMAC', await comparisonKey, await expectedProof, await digest(match[1]));
  }

  async function fetchJSON(url, options, { allowMissing = false, mutation = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fetchImpl(url, { ...options, redirect: 'error', credentials: 'omit', signal: controller.signal });
      if (allowMissing && result.status === 404) return null;
      if (result.status !== 200) fail('UPSTREAM_HTTP_ERROR', 503, { uncertain: mutation });
      try { return await result.json(); }
      catch { fail('UPSTREAM_INVALID_RESPONSE', 503, { uncertain: mutation }); }
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      fail(controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR', 503, { uncertain: mutation });
    } finally { clearTimeout(timer); }
  }

  async function rpc(name, parameters) {
    if (!RPC_NAMES.has(name)) fail('UNSUPPORTED_RPC', 500);
    return fetchJSON(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: config.serviceRoleKey, authorization: `Bearer ${config.serviceRoleKey}`,
        'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(parameters),
    }, { mutation: name !== 'brevo_check_lease' });
  }

  async function release(jobKey, code, delay) {
    return (await rpc('brevo_fail', { ...jobKey, p_error_code: code,
      p_retry_seconds: Math.min(86400, Math.max(0, delay)) })) === true;
  }

  async function applySuppression(eventKey, eventEmail, contactId, reason) {
    const result = await rpc('brevo_apply_opt_out', { p_event_key: eventKey, p_email: eventEmail,
      p_provider_contact_id: contactId, p_reason: reason });
    if (!object(result) || typeof result.applied !== 'boolean'
      || (result.applied ? result.reason !== reason : !['unknown_contact', 'duplicate_event'].includes(result.reason))) fail('INVALID_OPT_OUT_RESPONSE', 503);
    return result;
  }

  async function keyFor(parts) {
    const hash = await digest(JSON.stringify(parts));
    return `brevo:${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  async function sync(payload) {
    if (!object(payload) || Object.keys(payload).some(key => key !== 'limit')
      || (payload.limit !== undefined && (!positive(payload.limit) || payload.limit > 5))) fail('INVALID_SYNC_REQUEST', 400);
    const limit = payload.limit ?? 1, started = now();
    const counts = { claimed: 0, synced: 0, stale: 0, retryScheduled: 0, reviewRequired: 0 };
    const codes = new Set();
    for (let index = 0; index < limit && now() - started < maxRunMs; index++) {
      // Claim just in time, one row per iteration; never let later batch leases idle.
      let jobs;
      try { jobs = await rpc('brevo_claim', { p_limit: 1, p_lease_seconds: 300 }); }
      catch (error) { codes.add(error.code ?? 'CLAIM_FAILED'); counts.reviewRequired++; break; }
      if (!Array.isArray(jobs) || jobs.length > 1) { codes.add('INVALID_CLAIM_RESPONSE'); counts.reviewRequired++; break; }
      if (!jobs.length) break;
      counts.claimed++;
      const job = jobs[0];
      let jobKey;
      try { jobKey = validateJob(job); }
      catch { codes.add('INVALID_CLAIM_RESPONSE'); counts.reviewRequired++; break; }
      try {
        const desired = desiredFromJob(job);
        // A never-exported refusal needs no provider lookup: even a GET would
        // disclose a non-subscriber address. Uncertain creations retain their
        // lease, so they cannot reach this branch as fresh unmapped work.
        const neverExportedInactive = job.provider_contact_id === null
          && (!desired.eligible || desired.suppressAll || (!desired.ownNews && !desired.partnerOffers));
        const result = neverExportedInactive ? {status:'absent',contactId:null,verified:true} : await reconcile(desired, {
          assertCurrent: async () => (await rpc('brevo_check_lease', jobKey)) === true,
          expectedContactId: job.provider_contact_id,
        });
        if (!object(result) || result.verified !== true || !SAFE_STATUSES.has(result.status)
          || (result.status === 'absent' ? result.contactId !== null : !positive(result.contactId))) fail('INVALID_ADAPTER_RESULT', 503, { uncertain: true });
        if (result.status === 'suppressed' && job.suppress_all !== true) {
          // The adapter has freshly observed a native block. Persist delivery
          // suppression, never manufacture an unsubscribe from that observation.
          const applied = await applySuppression(await keyFor(['reconcile', job.email, result.contactId, 'blocked']),
            job.email, result.contactId, 'blocked');
          if (!applied.applied && applied.reason !== 'duplicate_event') fail('LOCAL_SUPPRESSION_NOT_CONFIRMED', 409);
        }
        // Even an unchanged provider record must not acknowledge superseded work.
        if ((await rpc('brevo_check_lease', jobKey)) !== true) {
          counts.stale++; codes.add('STALE_DESIRED_STATE');
          if (!(await release(jobKey, 'STALE_DESIRED_STATE', 0))) { counts.reviewRequired++; codes.add('LEASE_RELEASE_REJECTED'); }
          continue;
        }
        const acknowledged = await rpc('brevo_ack', { ...jobKey, p_provider_contact_id: result.contactId });
        if (acknowledged !== true) { counts.stale++; codes.add('ACK_REJECTED'); continue; }
        counts.synced++;
      } catch (error) {
        const safeAdapter = error instanceof BrevoAdapterError;
        const code = safeAdapter || error instanceof WorkerError ? error.code : 'WORKER_FAILED';
        codes.add(code);
        if (safeAdapter && code === 'MAPPED_CONTACT_MISSING') {
          try {
            const applied = await applySuppression(await keyFor(['reconcile', job.email, job.provider_contact_id, 'deleted']),
              job.email, job.provider_contact_id, 'deleted');
            if ((!applied.applied && applied.reason !== 'duplicate_event')
              || !(await release(jobKey, 'MAPPED_CONTACT_MISSING', 0))) fail('LOCAL_SUPPRESSION_NOT_CONFIRMED', 409);
            counts.stale++;
          } catch { counts.reviewRequired++; codes.add('LOCAL_SUPPRESSION_NOT_CONFIRMED'); }
          continue;
        }
        if (safeAdapter && code === 'CONTACT_IDENTITY_CHANGED') { counts.reviewRequired++; continue; }
        const stale = safeAdapter && error.code === 'STALE_DESIRED_STATE';
        // A stale preflight happens between completed requests: safely release only
        // its exact token. A timed-out/unknown mutation must retain its lease.
        const uncertain = !stale && (safeAdapter ? error.mayHaveChanged : true);
        if (uncertain) { counts.reviewRequired++; continue; }
        try {
          const delay = stale ? 0 : safeAdapter && error.retryAfterSeconds !== null ? error.retryAfterSeconds : 60;
          if (await release(jobKey, code, delay)) {
            if (stale) counts.stale++; else counts.retryScheduled++;
          } else { counts.reviewRequired++; codes.add('LEASE_RELEASE_REJECTED'); }
        } catch { counts.reviewRequired++; codes.add('LEASE_RELEASE_FAILED'); }
      }
    }
    const ok = counts.stale + counts.retryScheduled + counts.reviewRequired === 0;
    return response({ ok, ...counts, codes: [...codes] }, ok ? 200 : counts.reviewRequired || counts.stale ? 409 : 503);
  }

  async function webhook(payload) {
    const event = validateEvent(payload, now);
    const contact = await fetchJSON(`${BREVO_API}/contacts/${encodeURIComponent(event.email)}?identifierType=email_id`, {
      method: 'GET', headers: { 'api-key': config.apiKey, accept: 'application/json' },
    }, { allowMissing: true });
    let contactId = null;
    if (event.event === 'contact_deleted') {
      // A delayed deletion for a currently present contact is ambiguous. Never
      // suppress its newer incarnation based on the old payload alone.
      if (contact !== null) fail('DELETION_NOT_CONFIRMED', 409);
    } else {
      if (!object(contact) || !positive(contact.id) || typeof contact.emailBlacklisted !== 'boolean') fail('BLOCK_NOT_CONFIRMED', 409);
      if (email(contact.email) !== event.email) fail('CONTACT_IDENTITY_CHANGED', 409);
      if (!contact.emailBlacklisted) fail('BLOCK_NOT_CONFIRMED', 409);
      contactId = contact.id;
    }
    const eventKey = await keyFor([event.event, event.email, event.timestamp, event.webhookId, event.campaignId]);
    const result = await applySuppression(eventKey, event.email, contactId, event.reason);
    return response({ ok: true, applied: result.applied, reason: result.reason });
  }

  return async function handle(request) {
    try {
      const path = new URL(request.url).pathname;
      const route = ['sync', 'webhook'].find(name => [`/${name}`, `/${FUNCTION_NAME}/${name}`, `/functions/v1/${FUNCTION_NAME}/${name}`].includes(path));
      if (!route) return response({ ok: false, code: 'NOT_FOUND' }, 404);
      if (request.method !== 'POST') return response({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
      if (!(await authenticated(request, route === 'sync' ? workerProof : webhookProof))) return response({ ok: false, code: 'UNAUTHORIZED' }, 401);
      const payload = await readBody(request);
      return route === 'sync' ? await sync(payload) : await webhook(payload);
    } catch (error) {
      return response({ ok: false, code: error instanceof WorkerError ? error.code : 'WORKER_FAILED' }, error instanceof WorkerError ? error.status : 503);
    }
  };
}
