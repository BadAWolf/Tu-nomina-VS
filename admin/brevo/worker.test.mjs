import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { BrevoAdapterError } from './adapter.mjs';
import { createBrevoWorker, MAX_BODY_BYTES } from './worker.mjs';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const EMAIL = 'subscriber@example.test';
const config = { apiKey: 'synthetic-brevo-api-key', serviceRoleKey: 'synthetic-service-role-key',
  workerToken: 'synthetic-worker-token-12345678901234567890',
  webhookToken: 'synthetic-webhook-token-09876543210987654321',
  supabaseUrl: 'https://test-project.supabase.co', ownListId: 3, partnerListId: 4 };
const job = overrides => ({ email: EMAIL, user_id: '11111111-1111-4111-8111-111111111111',
  generation: 2, lease_token: '22222222-2222-4222-8222-222222222222', lease_until: '2026-09-23T12:05:00Z',
  provider_contact_id: 77, eligible: true, own_news: true, partner_offers: false, personalize: false,
  consent_version: '2026-09-15-marketing-v2', consent_at: '2026-09-23T11:00:00Z',
  suppress_all: false, deleted: false, ...overrides });
const remote = overrides => ({ id: 77, email: EMAIL, emailBlacklisted: true, listIds: [],
  attributes: { NV_OWN: false, NV_PARTNER: false, NV_PERSONALIZE: false }, ...overrides });
const event = overrides => ({ event: 'unsubscribe', email: EMAIL, id: 9999, camp_id: 44,
  ts_event: NOW / 1000 - 30, ts: NOW / 1000, ...overrides });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const success = async () => ({ status: 'updated', contactId: 77, verified: true });

function fixture({ jobs = [], reconcile = success, rpcHook, provider = remote(), fetchHook } = {}) {
  const calls = [], queue = structuredClone(jobs);
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url), body = options.body ? JSON.parse(options.body) : undefined;
    const call = { url, host: parsed.hostname, path: parsed.pathname, ...options, body };
    calls.push(call);
    const intercepted = await fetchHook?.(call);
    if (intercepted) return intercepted;
    if (parsed.hostname === 'test-project.supabase.co') {
      const name = parsed.pathname.split('/').at(-1);
      const result = await rpcHook?.(name, body);
      if (result !== undefined) return result instanceof Response ? result : json(result);
      if (name === 'brevo_claim') return json(queue.length ? [queue.shift()] : []);
      if (name === 'brevo_apply_opt_out') return json({ applied: true, reason: body.p_reason });
      return json(true);
    }
    assert.equal(parsed.hostname, 'api.brevo.com');
    assert.equal(options.method, 'GET', 'worker test must never unexpectedly mutate the provider');
    return provider === null ? json({}, 404) : json(provider);
  };
  const handler = createBrevoWorker(config, { fetchImpl, cryptoImpl: webcrypto, now: () => NOW,
    ...(reconcile === null ? {} : { reconcileImpl: reconcile }) });
  return { handler, calls };
}

function request(path, body = {}, token = config.workerToken, extra = {}) {
  return new Request(`https://test-project.supabase.co/functions/v1/brevo-marketing${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), ...extra,
  });
}
const rpcCalls = (f, name) => f.calls.filter(call => call.path.endsWith(`/rpc/${name}`));
const providerCalls = f => f.calls.filter(call => call.host === 'api.brevo.com');

test('unauthenticated and cross-route bearer requests cause zero RPC/API calls', async () => {
  const f = fixture();
  for (const [path, token] of [['/sync', null], ['/sync', 'wrong-secret-value'], ['/webhook', config.workerToken], ['/sync', config.webhookToken]]) {
    const result = await f.handler(request(path, event(), token));
    assert.equal(result.status, 401);
    assert.equal(f.calls.length, 0);
  }
});

test('unknown routes and non-POST methods never access providers', async () => {
  const f = fixture();
  assert.equal((await f.handler(request('/send', {}))).status, 404);
  assert.equal((await f.handler(new Request('https://example.test/sync', { method: 'GET' }))).status, 405);
  assert.equal(f.calls.length, 0);
});

test('rejects oversized bodies both by declared length and by streamed byte count', async () => {
  for (const extra of [{ headers: { 'content-type': 'application/json', authorization: `Bearer ${config.workerToken}`, 'content-length': String(MAX_BODY_BYTES + 1) } }, {}]) {
    const f = fixture();
    assert.equal((await f.handler(request('/sync', 'x'.repeat(MAX_BODY_BYTES + 1), config.workerToken, extra))).status, 413);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.handler(request('/sync', JSON.stringify({ text: 'é'.repeat(MAX_BODY_BYTES / 2) })))).status, 413);
  assert.equal(f.calls.length, 0);
});

test('malformed bodies, unsupported JSON shapes and caller-supplied targets are rejected', async () => {
  for (const body of ['not-json', [], { limit: 6 }, { limit: 0 }, { limit: '1' }, { url: 'https://attacker.example.test/' }]) {
    const f = fixture();
    assert.equal((await f.handler(request('/sync', body))).status, 400);
    assert.equal(f.calls.length, 0);
  }
});

test('sync claims one row just in time and acknowledges only a fresh verified result', async () => {
  let options;
  const f = fixture({ jobs: [job()], reconcile: async (desired, received) => {
    options = received;
    assert.equal(desired.email, EMAIL);
    assert.equal(received.expectedContactId, 77);
    assert.equal(await received.assertCurrent(), true);
    return success();
  } });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, claimed: 1, synced: 1, stale: 0, retryScheduled: 0, reviewRequired: 0, codes: [] });
  assert.equal(typeof options.assertCurrent, 'function');
  assert.deepEqual(rpcCalls(f, 'brevo_claim')[0].body, { p_limit: 1, p_lease_seconds: 300 });
  assert.equal(rpcCalls(f, 'brevo_check_lease').length, 2);
  assert.deepEqual(rpcCalls(f, 'brevo_ack')[0].body, {
    p_email: EMAIL, p_generation: 2, p_lease_token: job().lease_token, p_provider_contact_id: 77,
  });
  for (const call of f.calls) {
    assert.equal(call.headers.apikey, config.serviceRoleKey);
    assert.equal(call.headers.authorization, `Bearer ${config.serviceRoleKey}`);
    assert.equal(call.redirect, 'error');
    assert.equal(call.credentials, 'omit');
  }
});

test('default sync with empty queue performs no provider request', async () => {
  const f = fixture();
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).claimed, 0);
  assert.equal(providerCalls(f).length, 0);
});

test('never-exported refusals and unverified choices do not disclose email to Brevo', async () => {
  for (const overrides of [
    {own_news:false,partner_offers:false}, {eligible:false}, {suppress_all:true},
  ]) {
    const f=fixture({jobs:[job({provider_contact_id:null,...overrides})],
      reconcile:async()=>{throw Error('Must not disclose a never-subscribed address');}});
    const response=await f.handler(request('/sync'));
    assert.equal(response.status,200);
    assert.equal((await response.json()).synced,1);
    assert.equal(providerCalls(f).length,0);
    assert.equal(rpcCalls(f,'brevo_ack')[0].body.p_provider_contact_id,null);
  }
});

test('previously exported withdrawals still reconcile provider cleanup', async()=>{
  let called=false;
  const f=fixture({jobs:[job({own_news:false,partner_offers:false})],reconcile:async()=>{called=true;return success();}});
  assert.equal((await f.handler(request('/sync'))).status,200);
  assert.equal(called,true);
});

test('stale preflight releases its exact token without acknowledgement or provider writes', async () => {
  const f = fixture({ jobs: [job()], provider: remote({ emailBlacklisted: false }), reconcile: null,
    rpcHook: name => name === 'brevo_check_lease' ? false : undefined });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).stale, 1);
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.equal(rpcCalls(f, 'brevo_fail')[0].body.p_error_code, 'STALE_DESIRED_STATE');
  assert.equal(rpcCalls(f, 'brevo_fail')[0].body.p_lease_token, job().lease_token);
  assert.ok(providerCalls(f).every(call => call.method === 'GET'));
});

test('superseded state after successful reconciliation is not acknowledged', async () => {
  const f = fixture({ jobs: [job()], rpcHook: name => name === 'brevo_check_lease' ? false : undefined });
  const result = await f.handler(request('/sync'));
  assert.equal((await result.json()).stale, 1);
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.equal(rpcCalls(f, 'brevo_fail').length, 1);
});

test('safe before-write rate limit schedules a bounded retry and never acknowledges', async () => {
  const f = fixture({ jobs: [job()], reconcile: async () => { throw new BrevoAdapterError('HTTP_ERROR', {
    operation: 'read', status: 429, retryable: true, retryAfterSeconds: 30,
  }); } });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).retryScheduled, 1);
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.equal(rpcCalls(f, 'brevo_fail')[0].body.p_retry_seconds, 30);
});

test('uncertain provider mutation retains the lease and never acknowledges or retries', async () => {
  const f = fixture({ jobs: [job()], reconcile: async () => { throw new BrevoAdapterError('TIMEOUT', { operation: 'update', mayHaveChanged: true }); } });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).reviewRequired, 1);
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.equal(rpcCalls(f, 'brevo_fail').length, 0);
});

test('rejected acknowledgement is reported, never counted as synchronized', async () => {
  const f = fixture({ jobs: [job()], rpcHook: name => name === 'brevo_ack' ? false : undefined });
  const result = await f.handler(request('/sync'));
  const body = await result.json();
  assert.equal(body.synced, 0);
  assert.equal(body.stale, 1);
  assert.ok(body.codes.includes('ACK_REJECTED'));
  assert.equal(rpcCalls(f, 'brevo_fail').length, 0);
});

test('uncertain acknowledgement does not release a potentially reassigned lease', async () => {
  const f = fixture({ jobs: [job()], rpcHook: name => { if (name === 'brevo_ack') throw new Error('private-upstream-message'); } });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).reviewRequired, 1);
  assert.equal(rpcCalls(f, 'brevo_fail').length, 0);
});

test('mapped provider deletion suppresses technically and cannot recreate or acknowledge active consent', async () => {
  const f = fixture({ jobs: [job()], reconcile: null, provider: null });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).stale, 1);
  assert.equal(rpcCalls(f, 'brevo_apply_opt_out')[0].body.p_reason, 'deleted');
  assert.equal(rpcCalls(f, 'brevo_apply_opt_out')[0].body.p_provider_contact_id, 77);
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.ok(providerCalls(f).every(call => call.method === 'GET'));
});

test('already-suppressed mapped deletion completes the tombstone without an endless loop', async () => {
  const f = fixture({ jobs: [job({ eligible: false, own_news: false, suppress_all: true, deleted: true })], reconcile: null, provider: null });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).synced, 1);
  assert.equal(rpcCalls(f, 'brevo_apply_opt_out').length, 0);
  assert.equal(rpcCalls(f, 'brevo_ack')[0].body.p_provider_contact_id, null);
  assert.ok(providerCalls(f).every(call => call.method === 'GET'));
});

test('replacement provider identity holds the job for review before mutation', async () => {
  const f = fixture({ jobs: [job()], reconcile: null, provider: remote({ id: 88 }) });
  const result = await f.handler(request('/sync'));
  assert.equal((await result.json()).reviewRequired, 1);
  assert.equal(rpcCalls(f, 'brevo_apply_opt_out').length, 0);
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.equal(rpcCalls(f, 'brevo_fail').length, 0);
  assert.ok(providerCalls(f).every(call => call.method === 'GET'));
});

test('native block discovered during sync becomes durable technical suppression before any ack', async () => {
  let suppressed = false;
  const f = fixture({ jobs: [job()], reconcile: null, rpcHook: name => {
    if (name === 'brevo_apply_opt_out') { suppressed = true; return { applied: true, reason: 'blocked' }; }
    if (name === 'brevo_check_lease') return !suppressed;
  } });
  const result = await f.handler(request('/sync'));
  assert.equal((await result.json()).stale, 1);
  assert.equal(rpcCalls(f, 'brevo_apply_opt_out')[0].body.p_reason, 'blocked');
  assert.equal(rpcCalls(f, 'brevo_ack').length, 0);
  assert.equal(rpcCalls(f, 'brevo_fail').length, 1);
});

test('unsupported, batched, invalid-time or incomplete webhooks cause no API or RPC calls', async () => {
  for (const payload of [event({ event: 'list_addition' }), [event()], event({ event: 'contactUpdated' }),
    event({ ts_event: NOW / 1000 + 301 }), event({ ts_event: '123' }), event({ email: undefined })]) {
    const f = fixture();
    const result = await f.handler(request('/webhook', payload, config.webhookToken));
    assert.ok([400, 422].includes(result.status));
    assert.equal(f.calls.length, 0);
  }
});

test('fresh blocked unsubscribe uses provider contact ID, never payload webhook ID', async () => {
  const f = fixture();
  const result = await f.handler(request('/webhook', event(), config.webhookToken));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, applied: true, reason: 'unsubscribe' });
  const apply = rpcCalls(f, 'brevo_apply_opt_out')[0];
  assert.equal(apply.body.p_provider_contact_id, 77);
  assert.notEqual(apply.body.p_provider_contact_id, event().id);
  assert.match(apply.body.p_event_key, /^brevo:[0-9a-f]{64}$/u);
  assert.ok(f.calls.indexOf(providerCalls(f)[0]) < f.calls.indexOf(apply));
  assert.ok(providerCalls(f).every(call => call.method === 'GET'));
});

test('spam and hard bounce retain distinct canonical reasons', async () => {
  for (const [name, reason] of [['spam', 'complaint'], ['hard_bounce', 'hard_bounce']]) {
    const f = fixture();
    assert.equal((await f.handler(request('/webhook', event({ event: name }), config.webhookToken))).status, 200);
    assert.equal(rpcCalls(f, 'brevo_apply_opt_out')[0].body.p_reason, reason);
  }
});

test('webhooks require fresh native blocking; absent or currently unblocked contacts need review', async () => {
  for (const provider of [null, remote({ emailBlacklisted: false }), remote({ email: 'other@example.test' })]) {
    const f = fixture({ provider });
    assert.equal((await f.handler(request('/webhook', event(), config.webhookToken))).status, 409);
    assert.equal(rpcCalls(f, 'brevo_apply_opt_out').length, 0);
  }
});

test('contact deletion requires fresh 404 and never deletes the local account', async () => {
  const f = fixture({ provider: null });
  const payload = event({ event: 'contact_deleted', ts_event: undefined, camp_id: undefined });
  assert.equal((await f.handler(request('/webhook', payload, config.webhookToken))).status, 200);
  const call = rpcCalls(f, 'brevo_apply_opt_out')[0];
  assert.equal(call.body.p_reason, 'deleted');
  assert.equal(call.body.p_provider_contact_id, null);
  assert.equal(f.calls.length, 2);
  const present = fixture();
  assert.equal((await present.handler(request('/webhook', payload, config.webhookToken))).status, 409);
  assert.equal(rpcCalls(present, 'brevo_apply_opt_out').length, 0);
});

test('event key is stable across delivery retries and duplicate response is accepted', async () => {
  let applied = false;
  const f = fixture({ rpcHook: name => {
    if (name !== 'brevo_apply_opt_out') return;
    if (applied) return { applied: false, reason: 'duplicate_event' };
    applied = true; return { applied: true, reason: 'unsubscribe' };
  } });
  assert.equal((await f.handler(request('/webhook', event(), config.webhookToken))).status, 200);
  const duplicate = await f.handler(request('/webhook', event({ date_event: 'unused display time' }), config.webhookToken));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).reason, 'duplicate_event');
  assert.equal(rpcCalls(f, 'brevo_apply_opt_out')[0].body.p_event_key, rpcCalls(f, 'brevo_apply_opt_out')[1].body.p_event_key);
});

test('unknown local contacts are ignored without being created or opted in', async () => {
  const f = fixture({ rpcHook: name => name === 'brevo_apply_opt_out' ? { applied: false, reason: 'unknown_contact' } : undefined });
  const result = await f.handler(request('/webhook', event(), config.webhookToken));
  assert.equal((await result.json()).reason, 'unknown_contact');
  assert.ok(f.calls.every(call => !call.path.includes('/auth/') && !call.path.includes('/emailCampaigns')));
});

test('payload URLs are never fetched and all outgoing origins/methods stay fixed', async () => {
  const f = fixture();
  await f.handler(request('/webhook', event({ url: 'https://attacker.example.test/steal', notifyUrl: 'http://127.0.0.1/' }), config.webhookToken));
  assert.ok(f.calls.every(call => ['test-project.supabase.co', 'api.brevo.com'].includes(call.host)));
  assert.ok(f.calls.every(call => call.redirect === 'error' && call.credentials === 'omit'));
});

test('upstream failures and exceptions never leak email, tokens or raw provider messages', async () => {
  const secretText = `${EMAIL} ${config.apiKey} ${config.serviceRoleKey} sensitive-payload`;
  for (const fetchHook of [() => json({ message: secretText }, 500), () => { throw new Error(secretText); }]) {
    const f = fixture({ fetchHook });
    const result = await f.handler(request('/webhook', event(), config.webhookToken));
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /subscriber@|synthetic-|sensitive-payload/u);
  }
});

test('unrecognized adapter exceptions hold the lease and return only safe error codes', async () => {
  const f = fixture({ jobs: [job()], reconcile: async () => { throw new Error(`${EMAIL} ${config.apiKey}`); } });
  const result = await f.handler(request('/sync'));
  assert.equal(result.status, 409);
  assert.doesNotMatch(await result.text(), /subscriber@|synthetic-/u);
  assert.equal(rpcCalls(f, 'brevo_fail').length, 0);
});

test('configuration rejects arbitrary origins, duplicate secrets and short bearer tokens', () => {
  for (const change of [{ supabaseUrl: 'https://attacker.example.test' }, { supabaseUrl: 'https://test-project.supabase.co@attacker.example.test' },
    { supabaseUrl: 'https://test-project.supabase.co/path' }, { workerToken: config.webhookToken }, { webhookToken: 'short' }]) {
    assert.throws(() => createBrevoWorker({ ...config, ...change }, { cryptoImpl: webcrypto }), /INVALID_|TOKENS_MUST/u);
  }
});
