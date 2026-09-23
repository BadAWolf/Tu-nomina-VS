import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTE_DEFINITIONS, BrevoAdapterError, createBrevoAdapter, desiredFromJob } from './adapter.mjs';

const EMAIL = 'subscriber@example.test';
const OWN = 101, PARTNER = 102;
const consent = { email: EMAIL, eligible: true, ownNews: true, partnerOffers: false,
  personalize: false, consentVersion: '2026-09-15-marketing-v2', consentAt: '2026-09-23T12:00:00Z' };
const attrs = overrides => ({ NV_OWN: true, NV_PARTNER: false, NV_PERSONALIZE: false,
  NV_CONSENT_VERSION: consent.consentVersion, NV_CONSENT_AT: '2026-09-23T12:00:00.000Z', ...overrides });
const contact = overrides => ({ id: 77, email: EMAIL, emailBlacklisted: false,
  listIds: [OWN], attributes: attrs(), ...overrides });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

// Every request is handled by this in-memory provider; tests never use network fetch.
function fixture({ existing = null, hook = null, ignoreAttributes = [], ignoreMembership = false } = {}) {
  const state = { contact: structuredClone(existing), requests: [], reads: 0 };
  const fetchImpl = async (url, options) => {
    const request = { url, ...options, body: options.body === undefined ? undefined : JSON.parse(options.body) };
    state.requests.push(request);
    const parsed = new URL(url);
    if (options.method === 'GET') state.reads++;
    const intercepted = await hook?.(request, state);
    if (intercepted) return intercepted;
    if (options.method === 'GET') {
      const identifier = decodeURIComponent(parsed.pathname.split('/').at(-1));
      const matches = state.contact && (parsed.searchParams.get('identifierType') === 'contact_id'
        ? String(state.contact.id) === identifier : state.contact.email.toLowerCase() === identifier);
      return matches ? json(state.contact) : json({ code: 'document_not_found' }, 404);
    }
    if (options.method === 'POST') {
      if (state.contact) return json({ code: 'duplicate_parameter' }, 400);
      state.contact = { id: 77, email: request.body.email, emailBlacklisted: false,
        attributes: structuredClone(request.body.attributes), listIds: [...request.body.listIds] };
      return json({ id: 77 }, 201);
    }
    assert.equal(options.method, 'PUT');
    assert.equal(parsed.searchParams.get('identifierType'), 'contact_id');
    assert.equal(parsed.pathname.split('/').at(-1), String(state.contact.id));
    for (const [key, value] of Object.entries(request.body.attributes ?? {})) {
      if (!ignoreAttributes.includes(key)) state.contact.attributes[key] = value;
    }
    if (!ignoreMembership) {
      state.contact.listIds = [...new Set([...state.contact.listIds, ...(request.body.listIds ?? [])])]
        .filter(id => !(request.body.unlinkListIds ?? []).includes(id));
    }
    if (request.body.emailBlacklisted !== undefined) state.contact.emailBlacklisted = request.body.emailBlacklisted;
    return new Response(null, { status: 204 });
  };
  const adapter = createBrevoAdapter({ apiKey: 'test-only-api-key', ownListId: OWN, partnerListId: PARTNER, fetchImpl });
  return { ...adapter, state, fetchImpl };
}

const writes = state => state.requests.filter(request => request.method !== 'GET');
function assertSafeWrites(state) {
  for (const request of writes(state)) {
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.body.emailBlacklisted === false, false);
    assert.equal(request.body.ext_id, undefined);
    assert.notEqual(request.body.forceMerge, true);
    assert.equal(request.body.attributes?.EMAIL, undefined);
    if (request.method === 'PUT') assert.equal(request.body.email, undefined);
    for (const [name, value] of Object.entries(request.body.attributes ?? {})) {
      assert.match(name, /^NV_/u);
      if (['NV_AGE_BAND', 'NV_PROVINCE_CODE', 'NV_CITY'].includes(name)) assert.equal(value, '');
    }
  }
}

test('creates only an opted-in audience and verifies the created contact by ID', async () => {
  const f = fixture();
  assert.deepEqual(await f.reconcileContact({ ...consent, email: EMAIL.toUpperCase() }),
    { status: 'created', contactId: 77, verified: true });
  assert.deepEqual(f.state.contact.listIds, [OWN]);
  assert.deepEqual(writes(f.state)[0].body, { email: EMAIL, attributes: attrs(), listIds: [OWN], updateEnabled: false, forceMerge: false });
  assert.equal(f.state.requests.at(-1).url, 'https://api.brevo.com/v3/contacts/77?identifierType=contact_id');
  assertSafeWrites(f.state);
});

test('keeps own-news and partner permissions separate', async () => {
  const f = fixture();
  await f.reconcileContact({ ...consent, ownNews: false, partnerOffers: true });
  assert.deepEqual(f.state.contact.listIds, [PARTNER]);
  assert.equal(f.state.contact.attributes.NV_OWN, false);
  assert.equal(f.state.contact.attributes.NV_PARTNER, true);
  assertSafeWrites(f.state);
});

test('removes a withdrawn category without modifying another brand list or attributes', async () => {
  const f = fixture({ existing: contact({ listIds: [OWN, PARTNER, 999], attributes: attrs({ NV_PARTNER: true, OTHER_BRAND: 'keep' }) }) });
  assert.equal((await f.reconcileContact(consent)).status, 'updated');
  assert.deepEqual(f.state.contact.listIds, [OWN, 999]);
  assert.equal(f.state.contact.attributes.OTHER_BRAND, 'keep');
  assert.deepEqual(writes(f.state)[0].body, { attributes: { NV_PARTNER: false }, unlinkListIds: [PARTNER] });
  assertSafeWrites(f.state);
});

test('does not write when remote state already matches', async () => {
  const f = fixture({ existing: contact() });
  assert.deepEqual(await f.reconcileContact(consent), { status: 'unchanged', contactId: 77, verified: true });
  assert.equal(f.state.requests.length, 1);
});

test('missing unsubscribed or ineligible contacts are not created', async () => {
  for (const desired of [{ ...consent, ownNews: false }, { ...consent, eligible: false }, { ...consent, suppressAll: true }]) {
    const f = fixture();
    assert.deepEqual(await f.reconcileContact(desired), { status: 'absent', contactId: null, verified: true });
    assert.equal(writes(f.state).length, 0);
  }
});

test('existing native blacklist always wins over a local opt-in', async () => {
  const f = fixture({ existing: contact({ emailBlacklisted: true, listIds: [OWN, PARTNER, 999] }) });
  assert.equal((await f.reconcileContact({ ...consent, partnerOffers: true, personalize: true })).status, 'suppressed');
  assert.deepEqual(f.state.contact.listIds, [999]);
  assert.equal(f.state.contact.emailBlacklisted, true);
  assert.equal(f.state.contact.attributes.NV_OWN, false);
  assert.equal(f.state.contact.attributes.NV_PARTNER, false);
  assert.equal(f.state.contact.attributes.NV_PERSONALIZE, false);
  assertSafeWrites(f.state);
});

test('explicit global suppression can only set the block to true', async () => {
  const f = fixture({ existing: contact() });
  assert.equal((await f.reconcileContact({ ...consent, suppressAll: true })).status, 'suppressed');
  assert.equal(f.state.contact.emailBlacklisted, true);
  assert.deepEqual(f.state.contact.listIds, []);
  assert.ok(writes(f.state).some(request => request.body.emailBlacklisted === true));
  assertSafeWrites(f.state);
});

test('clears old demographics while excluded, verifies erasure, then restores only current lists', async () => {
  const f = fixture({ existing: contact({ listIds: [OWN, PARTNER, 999], attributes: attrs({ NV_PERSONALIZE: true,
    NV_AGE_BAND: '35-44', NV_PROVINCE_CODE: '02', NV_CITY: 'Test City' }) }) });
  await f.reconcileContact({ ...consent, personalize: true });
  const changes = writes(f.state);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].body.unlinkListIds, [OWN, PARTNER]);
  assert.equal(changes[0].body.listIds, undefined);
  assert.deepEqual(changes[0].body.attributes, { NV_AGE_BAND: '', NV_PROVINCE_CODE: '', NV_CITY: '' });
  assert.deepEqual(changes[1].body.listIds, [OWN]);
  assert.deepEqual(f.state.contact.listIds, [999, OWN]);
  assert.deepEqual(f.state.requests.map(r => r.method), ['GET', 'PUT', 'GET', 'PUT', 'GET']);
  assertSafeWrites(f.state);
});

test('ignored demographic erasure fails and never restores list membership', async () => {
  const f = fixture({ existing: contact({ attributes: attrs({ NV_CITY: 'Test City' }) }), ignoreAttributes: ['NV_CITY'] });
  await assert.rejects(f.reconcileContact(consent), error => {
    assert.equal(error.code, 'CLEARANCE_NOT_CONFIRMED');
    assert.equal(error.mayHaveChanged, true);
    assert.deepEqual(error.fields, ['NV_CITY']);
    return true;
  });
  assert.deepEqual(f.state.contact.listIds, []);
  assert.equal(writes(f.state).length, 1);
});

test('personalization consent never uploads age or location', async () => {
  const f = fixture();
  await f.reconcileContact({ ...consent, personalize: true });
  assert.equal(f.state.contact.attributes.NV_PERSONALIZE, true);
  for (const name of ['NV_AGE_BAND', 'NV_PROVINCE_CODE', 'NV_CITY']) assert.equal(name in f.state.contact.attributes, false);
  assertSafeWrites(f.state);
});

test('rejects profile input, non-booleans and unsupported fields before network access', async () => {
  for (const input of [{ ...consent, profile: { city: 'Test City' } }, { ...consent, ownNews: 'false' },
    { ...consent, personalize: true, ownNews: false }, { ...consent, email: 'bad\r\n@example.test' },
    { ...consent, consentAt: '2026-09-23T12:00:00' }]) {
    const f = fixture();
    await assert.rejects(f.reconcileContact(input), BrevoAdapterError);
    assert.equal(f.state.requests.length, 0);
  }
});

test('queue mapper uses canonical fields and does not copy profile or lease contents', () => {
  const desired = desiredFromJob({ email: EMAIL, eligible: true, own_news: true, partner_offers: false,
    personalize: false, consent_version: consent.consentVersion, consent_at: consent.consentAt,
    suppress_all: false, user_id: 'not-forwarded', lease_token: 'not-forwarded', deleted: false,
    city: 'not-forwarded', age_band: '35-44' });
  assert.deepEqual(desired, { ...consent, suppressAll: false });
});

test('identity mismatch, missing blacklist status and malformed provider data stop all writes', async () => {
  for (const body of [contact({ email: 'someone-else@example.test' }), contact({ emailBlacklisted: undefined }),
    contact({ id: '77' }), contact({ listIds: null }), contact({ attributes: [] })]) {
    const f = fixture({ hook: request => request.method === 'GET' ? json(body) : null });
    await assert.rejects(f.reconcileContact(consent), BrevoAdapterError);
    assert.equal(writes(f.state).length, 0);
  }
});

test('read errors are not mistaken for a missing contact', async () => {
  const f = fixture({ hook: () => json({ error: 'not allowed' }, 403) });
  await assert.rejects(f.reconcileContact(consent), error => error.code === 'HTTP_ERROR' && error.status === 403 && !error.mayHaveChanged);
  assert.equal(writes(f.state).length, 0);
});

test('unconfirmed list or attribute updates fail instead of reporting success', async () => {
  const f = fixture({ existing: contact({ listIds: [OWN, PARTNER] }), ignoreMembership: true });
  await assert.rejects(f.reconcileContact(consent), error => error.code === 'POSTCONDITION_FAILED' && error.mayHaveChanged);
  const missing = fixture({ existing: contact({ attributes: attrs({ NV_PARTNER: true }) }), ignoreAttributes: ['NV_PARTNER'] });
  await assert.rejects(missing.reconcileContact(consent), error => error.code === 'POSTCONDITION_FAILED');
});

test('contact disappearing after a write is never recreated in the same run', async () => {
  const f = fixture({ existing: contact({ attributes: attrs({ NV_PARTNER: true }) }), hook: (request, state) => {
    if (request.method === 'GET' && state.reads === 2) state.contact = null;
  } });
  await assert.rejects(f.reconcileContact(consent), error => error.code === 'CONTACT_DISAPPEARED' && error.mayHaveChanged);
  assert.deepEqual(writes(f.state).map(r => r.method), ['PUT']);
});

test('a native block appearing during a write causes bounded suppression cleanup', async () => {
  const f = fixture({ existing: contact({ attributes: attrs({ NV_PARTNER: true }) }), hook: (request, state) => {
    if (request.method === 'GET' && state.reads === 2) state.contact.emailBlacklisted = true;
  } });
  assert.equal((await f.reconcileContact(consent)).status, 'suppressed');
  assert.deepEqual(f.state.contact.listIds, []);
  assert.equal(f.state.contact.attributes.NV_OWN, false);
  assertSafeWrites(f.state);
});

test('freshness rejection prevents create and prevents stale restoration after clearance', async () => {
  const fresh = fixture();
  await assert.rejects(fresh.reconcileContact(consent, { assertCurrent: async () => false }), error => error.code === 'STALE_DESIRED_STATE' && !error.mayHaveChanged);
  assert.equal(writes(fresh.state).length, 0);
  const f = fixture({ existing: contact({ attributes: attrs({ NV_CITY: 'Test City' }) }) });
  let calls = 0;
  await assert.rejects(f.reconcileContact(consent, { assertCurrent: async () => ++calls === 1 }), error => error.code === 'STALE_DESIRED_STATE' && error.mayHaveChanged);
  assert.deepEqual(f.state.contact.listIds, []);
  assert.equal(writes(f.state).length, 1);
});

test('rate limits expose safe retry metadata without retrying or leaking bodies', async () => {
  const f = fixture({ hook: request => request.method === 'POST'
    ? json({ message: `test-only-api-key ${EMAIL} private-provider-message` }, 429, { 'retry-after': '30' }) : null });
  await assert.rejects(f.reconcileContact(consent), error => {
    assert.equal(error.retryAfterSeconds, 30);
    assert.equal(error.retryable, true);
    assert.equal(error.mayHaveChanged, true);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /test-only-api-key|subscriber@|private-provider-message/u);
    return true;
  });
  assert.equal(writes(f.state).length, 1);
});

test('transport exceptions and readback failures are sanitized and flagged as uncertain', async () => {
  const f = fixture({ hook: request => { if (request.method === 'POST') throw new Error(`secret ${EMAIL}`); } });
  await assert.rejects(f.reconcileContact(consent), error => error.code === 'NETWORK_ERROR' && error.mayHaveChanged && !error.message.includes(EMAIL) && error.cause === undefined);
  const readback = fixture({ hook: (request, state) => request.method === 'GET' && state.reads === 2 ? json({}, 503) : null });
  await assert.rejects(readback.reconcileContact(consent), error => error.status === 503 && error.mayHaveChanged);
});

test('timeout aborts fetch and a pre-aborted caller performs no request', async () => {
  const adapter = createBrevoAdapter({ apiKey: 'test-only', ownListId: OWN, partnerListId: PARTNER, timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await assert.rejects(adapter.reconcileContact(consent), error => error.code === 'TIMEOUT' && !error.mayHaveChanged);
  const f = fixture(), controller = new AbortController();
  controller.abort();
  await assert.rejects(f.reconcileContact(consent, { signal: controller.signal }), error => error.code === 'ABORTED');
  assert.equal(f.state.requests.length, 0);
});

test('configuration rejects overlapping lists and exposes no key on the adapter object', () => {
  assert.throws(() => createBrevoAdapter({ apiKey: 'test-only', ownListId: 1, partnerListId: 1 }), BrevoAdapterError);
  assert.throws(() => createBrevoAdapter({ apiKey: 'bad\r\nkey', ownListId: 1, partnerListId: 2 }), BrevoAdapterError);
  const adapter = createBrevoAdapter({ apiKey: 'test-only', ownListId: OWN, partnerListId: PARTNER, fetchImpl: async () => {} });
  assert.deepEqual(Object.keys(adapter), ['reconcileContact']);
  assert.deepEqual(ATTRIBUTE_DEFINITIONS.map(x => x.name), ['NV_OWN', 'NV_PARTNER', 'NV_PERSONALIZE', 'NV_CONSENT_VERSION', 'NV_CONSENT_AT']);
});

test('mapped missing contact is never recreated, even if local consent remains true', async () => {
  const f = fixture();
  await assert.rejects(f.reconcileContact(consent, { expectedContactId: 77 }), error => error.code === 'MAPPED_CONTACT_MISSING' && !error.mayHaveChanged);
  assert.equal(writes(f.state).length, 0);
  assert.deepEqual(await f.reconcileContact({ ...consent, suppressAll: true }, { expectedContactId: 77 }),
    { status: 'absent', contactId: null, verified: true });
  assert.equal(writes(f.state).length, 0);
});

test('mapped replacement identity is rejected before any mutation', async () => {
  const f = fixture({ existing: contact({ id: 88, attributes: attrs({ NV_CITY: 'Test City' }) }) });
  await assert.rejects(f.reconcileContact(consent, { expectedContactId: 77 }), error => error.code === 'CONTACT_IDENTITY_CHANGED' && !error.mayHaveChanged);
  assert.equal(writes(f.state).length, 0);
});
