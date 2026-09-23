// Server-only, dependency-free ES module. Compatible with Node and Deno.
// Canonical consent, scheduling, tombstones and webhook authentication live upstream.
const API = 'https://api.brevo.com/v3';
const PROFILE_FIELDS = Object.freeze(['NV_AGE_BAND', 'NV_PROVINCE_CODE', 'NV_CITY']);

export const ATTRIBUTE_DEFINITIONS = Object.freeze([
  Object.freeze({ name: 'NV_OWN', type: 'boolean' }),
  Object.freeze({ name: 'NV_PARTNER', type: 'boolean' }),
  Object.freeze({ name: 'NV_PERSONALIZE', type: 'boolean' }),
  Object.freeze({ name: 'NV_CONSENT_VERSION', type: 'text' }),
  Object.freeze({ name: 'NV_CONSENT_AT', type: 'text' }),
]);

/** Errors deliberately contain no provider body, URL, email, API key or raw cause. */
export class BrevoAdapterError extends Error {
  constructor(code, { operation = 'validate', status = null, retryable = false,
    mayHaveChanged = false, retryAfterSeconds = null, fields = [] } = {}) {
    super(`Brevo adapter: ${code} (${operation})`);
    this.name = 'BrevoAdapterError';
    Object.assign(this, { code, operation, status, retryable, mayHaveChanged,
      retryAfterSeconds, fields: [...fields] });
  }
}

const fail = (code, details) => { throw new BrevoAdapterError(code, details); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => Number.isSafeInteger(value) && value > 0;
const empty = value => value === undefined || value === null || value === '';

function emailAddress(value, code = 'INVALID_DESIRED_STATE') {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) fail(code);
  return value.toLowerCase();
}

function normalizeDesired(input) {
  if (!isObject(input)) fail('INVALID_DESIRED_STATE');
  // No demographic input is accepted. Historical notices keep these data in Supabase.
  const allowed = new Set(['email', 'eligible', 'ownNews', 'partnerOffers', 'personalize',
    'consentVersion', 'consentAt', 'suppressAll']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('UNSUPPORTED_DESIRED_FIELD');
  for (const key of ['eligible', 'ownNews', 'partnerOffers', 'personalize']) {
    if (typeof input[key] !== 'boolean') fail('INVALID_DESIRED_STATE');
  }
  if (input.suppressAll !== undefined && typeof input.suppressAll !== 'boolean') fail('INVALID_DESIRED_STATE');
  if (input.personalize && !input.ownNews && !input.partnerOffers) fail('INVALID_DESIRED_STATE');
  const canSubscribe = input.eligible && (input.ownNews || input.partnerOffers) && !input.suppressAll;
  let consentVersion = '', consentAt = '';
  if (canSubscribe) {
    if (typeof input.consentVersion !== 'string' || !input.consentVersion.trim()
      || input.consentVersion.length > 100 || /[\u0000-\u001f]/u.test(input.consentVersion)) fail('INVALID_CONSENT_EVIDENCE');
    if (typeof input.consentAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(input.consentAt)
      || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(input.consentAt) || !Number.isFinite(Date.parse(input.consentAt))) fail('INVALID_CONSENT_EVIDENCE');
    consentVersion = input.consentVersion;
    consentAt = new Date(input.consentAt).toISOString();
  }
  return { email: emailAddress(input.email), eligible: input.eligible,
    ownNews: input.ownNews, partnerOffers: input.partnerOffers, personalize: input.personalize,
    suppressAll: input.suppressAll === true, canSubscribe, consentVersion, consentAt };
}

/** Map a service-only queue row; deliberately discard IDs/leases and never read a profile. */
export function desiredFromJob(row) {
  if (!isObject(row)) fail('INVALID_DESIRED_STATE');
  const desired = { email: row.email, eligible: row.eligible, ownNews: row.own_news,
    partnerOffers: row.partner_offers, personalize: row.personalize,
    consentVersion: row.consent_version, consentAt: row.consent_at,
    suppressAll: row.suppress_all ?? false };
  normalizeDesired(desired);
  return desired;
}

function validateContact(value, email, expectedId = null) {
  if (!isObject(value) || !validId(value.id) || !isObject(value.attributes)
    || !Array.isArray(value.listIds) || value.listIds.some(id => !validId(id))
    || typeof value.emailBlacklisted !== 'boolean') fail('INVALID_PROVIDER_RESPONSE', { operation: 'read' });
  if (emailAddress(value.email, 'INVALID_PROVIDER_RESPONSE') !== email
    || (expectedId !== null && value.id !== expectedId)) fail('CONTACT_IDENTITY_CHANGED', { operation: 'read' });
  return value;
}

function desiredAttributes(desired, blocked) {
  const enabled = desired.canSubscribe && !blocked;
  return {
    NV_OWN: enabled && desired.ownNews,
    NV_PARTNER: enabled && desired.partnerOffers,
    // This is only a consent mirror; demographic data never leave Supabase here.
    NV_PERSONALIZE: enabled && desired.personalize,
    NV_CONSENT_VERSION: enabled ? desired.consentVersion : '',
    NV_CONSENT_AT: enabled ? desired.consentAt : '',
  };
}

function expectedState(desired, remote, ownListId, partnerListId) {
  const attributes = desiredAttributes(desired, remote?.emailBlacklisted === true);
  const listIds = [];
  if (attributes.NV_OWN) listIds.push(ownListId);
  if (attributes.NV_PARTNER) listIds.push(partnerListId);
  return { attributes, listIds };
}

function attributePatch(expected, existing) {
  const attributes = {};
  for (const [name, value] of Object.entries(expected)) {
    if (value === '' ? !empty(existing[name]) : existing[name] !== value) attributes[name] = value;
  }
  // These fields are cleanup-only. Never introduce a profile or preserve old values.
  for (const name of PROFILE_FIELDS) if (!empty(existing[name])) attributes[name] = '';
  return attributes;
}

function mismatches(remote, expected, managedLists, requireBlocked) {
  const fields = [];
  for (const [name, value] of Object.entries(expected.attributes)) {
    if (value === '' ? !empty(remote.attributes[name]) : remote.attributes[name] !== value) fields.push(name);
  }
  for (const name of PROFILE_FIELDS) if (!empty(remote.attributes[name])) fields.push(name);
  for (const list of managedLists) if (remote.listIds.includes(list) !== expected.listIds.includes(list)) fields.push('managed_list');
  if (requireBlocked && !remote.emailBlacklisted) fields.push('email_block');
  return [...new Set(fields)];
}

/**
 * No automatic retries, no send endpoint, no deletion, no blacklist reset.
 * Re-read canonical state before a caller-initiated retry after any error.
 */
export function createBrevoAdapter({ apiKey, ownListId, partnerListId,
  fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/u.test(apiKey)
    || !validId(ownListId) || !validId(partnerListId) || ownListId === partnerListId
    || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('INVALID_CONFIGURATION');
  const managedLists = [ownListId, partnerListId];

  async function request(method, path, body, { signal, allowMissing = false } = {}) {
    const operation = method === 'GET' ? 'read' : method === 'POST' ? 'create' : 'update';
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) fail('ABORTED', { operation });
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false, started = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      started = true;
      const response = await fetchImpl(`${API}${path}`, {
        method, headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', credentials: 'omit', signal: controller.signal,
      });
      if (response.status === 404 && allowMissing) return null;
      const accepted = method === 'GET' ? response.status === 200 : method === 'POST' ? response.status === 201 : response.status === 204;
      if (!accepted) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : null;
        fail('HTTP_ERROR', { operation, status: response.status,
          retryable: response.status === 425 || response.status === 429 || response.status >= 500,
          retryAfterSeconds: Number.isSafeInteger(seconds) ? seconds : null,
          mayHaveChanged: method !== 'GET' });
      }
      if (method === 'PUT') return null;
      try { return await response.json(); }
      catch { fail('INVALID_PROVIDER_RESPONSE', { operation, mayHaveChanged: method !== 'GET' }); }
    } catch (error) {
      if (error instanceof BrevoAdapterError) throw error;
      fail(timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'ABORTED' : 'NETWORK_ERROR', {
        operation, retryable: !signal?.aborted, mayHaveChanged: started && method !== 'GET',
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function reconcileContact(input, { signal, assertCurrent, expectedContactId = null } = {}) {
    const desired = normalizeDesired(input);
    if (assertCurrent !== undefined && typeof assertCurrent !== 'function') fail('INVALID_CONFIGURATION');
    if (expectedContactId !== null && !validId(expectedContactId)) fail('INVALID_CONFIGURATION');
    let wrote = false, created = false;
    const guard = async () => {
      if (signal?.aborted) fail('ABORTED', { operation: 'preflight' });
      if (!assertCurrent) return;
      let current;
      try { current = await assertCurrent(); }
      catch { fail('FRESHNESS_CHECK_FAILED', { operation: 'preflight', retryable: true }); }
      if (current !== true) fail('STALE_DESIRED_STATE', { operation: 'preflight' });
    };
    const read = async id => {
      const query = id === undefined ? `${encodeURIComponent(desired.email)}?identifierType=email_id`
        : `${id}?identifierType=contact_id`;
      const result = await request('GET', `/contacts/${query}`, undefined, { signal, allowMissing: true });
      return result === null ? null : validateContact(result, desired.email, id ?? expectedContactId);
    };
    const update = async (id, body) => {
      await guard();
      // Mark before I/O: timeouts can happen after a provider mutation has committed.
      wrote = true;
      await request('PUT', `/contacts/${id}?identifierType=contact_id`, body, { signal });
    };
    try {
      let remote = await read();
      if (!remote) {
        // When the desired state cannot subscribe, confirmed provider absence is
        // already the desired outcome. Otherwise report deletion, never recreate.
        if (expectedContactId !== null && desired.canSubscribe) fail('MAPPED_CONTACT_MISSING', { operation: 'read' });
        if (!desired.canSubscribe) return { status: 'absent', contactId: null, verified: true };
        const expected = expectedState(desired, null, ownListId, partnerListId);
        await guard();
        wrote = true;
        const result = await request('POST', '/contacts', {
          email: desired.email, attributes: expected.attributes, listIds: expected.listIds,
          updateEnabled: false, forceMerge: false,
        }, { signal });
        if (!isObject(result) || !validId(result.id)) fail('INVALID_PROVIDER_RESPONSE', { operation: 'create' });
        created = true;
        remote = await read(result.id);
        if (!remote) fail('CONTACT_DISAPPEARED', { operation: 'verify' });
        // A newly imposed remote block takes priority on the next pass below.
      }

      // Two passes permit one newly observed native block to be cleaned up, without
      // ever treating a webhook race or a missing provider attribute as success.
      for (let pass = 0; pass < 2; pass += 1) {
        let expected = expectedState(desired, remote, ownListId, partnerListId);
        let patch = attributePatch(expected.attributes, remote.attributes);
        const clears = Object.entries(patch).some(([, value]) => value === '');
        if (clears) {
          // Exclude before checking erasure; an ignored blank must not leave the
          // contact on our audience lists. Restoration happens only after readback.
          await update(remote.id, { attributes: patch, unlinkListIds: managedLists,
            ...(desired.suppressAll ? { emailBlacklisted: true } : {}) });
          const priorId = remote.id, wasBlocked = remote.emailBlacklisted;
          remote = await read(priorId);
          if (!remote) fail('CONTACT_DISAPPEARED', { operation: 'verify' });
          if (wasBlocked && !remote.emailBlacklisted) fail('REMOTE_BLOCK_REMOVED', { operation: 'verify' });
          const clearance = mismatches(remote, { attributes: expected.attributes, listIds: [] }, managedLists, desired.suppressAll);
          if (clearance.length) fail('CLEARANCE_NOT_CONFIRMED', { operation: 'verify', fields: clearance });
          expected = expectedState(desired, remote, ownListId, partnerListId);
          patch = attributePatch(expected.attributes, remote.attributes);
        }

        const add = expected.listIds.filter(id => !remote.listIds.includes(id));
        const remove = managedLists.filter(id => !expected.listIds.includes(id) && remote.listIds.includes(id));
        const mustBlock = desired.suppressAll && !remote.emailBlacklisted;
        if (Object.keys(patch).length || add.length || remove.length || mustBlock) {
          const wasBlocked = remote.emailBlacklisted, priorId = remote.id;
          await update(priorId, { ...(Object.keys(patch).length ? { attributes: patch } : {}),
            ...(add.length ? { listIds: add } : {}), ...(remove.length ? { unlinkListIds: remove } : {}),
            ...(mustBlock ? { emailBlacklisted: true } : {}) });
          remote = await read(priorId);
          if (!remote) fail('CONTACT_DISAPPEARED', { operation: 'verify' });
          if (wasBlocked && !remote.emailBlacklisted) fail('REMOTE_BLOCK_REMOVED', { operation: 'verify' });
        }

        const effective = expectedState(desired, remote, ownListId, partnerListId);
        const drift = mismatches(remote, effective, managedLists, desired.suppressAll);
        if (!drift.length) return { status: remote.emailBlacklisted || desired.suppressAll ? 'suppressed'
          : created ? 'created' : wrote ? 'updated' : 'unchanged', contactId: remote.id, verified: true };
        // Do not loop on generic rejection/ignored attributes. Only a newly seen
        // blacklist can justify a second suppression-only reconciliation pass.
        if (pass === 0 && remote.emailBlacklisted && expected.listIds.length) continue;
        fail('POSTCONDITION_FAILED', { operation: 'verify', fields: drift });
      }
      fail('POSTCONDITION_FAILED', { operation: 'verify' });
    } catch (error) {
      if (error instanceof BrevoAdapterError) {
        error.mayHaveChanged ||= wrote;
        throw error;
      }
      // Defensive boundary: never expose a transport/body exception to logs.
      fail('RECONCILIATION_FAILED', { operation: 'reconcile', mayHaveChanged: wrote });
    }
  }

  return Object.freeze({ reconcileContact });
}
