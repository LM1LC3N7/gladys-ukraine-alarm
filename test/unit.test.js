// -----------------------------------------------------------------------------
// The pure parts: the API client, the configuration, the location names.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, fetchStatuses, levelOf, parseStatuses, retryAfterMs } from '../src/api.js';
import { normalizeConfig, parseLocations, tokenState } from '../src/config.js';
import { LOCATIONS, fold, locationName, searchLocations } from '../src/locations.js';
import { tagOf } from '../src/app.js';
import { answer, statuses } from './helpers/world.js';

const call = (response, extra = {}) =>
  fetchStatuses({
    token: 'tok',
    version: '0.1.0',
    fetchImpl: async () => (typeof response === 'function' ? response() : response),
    timeoutMs: 200,
    ...extra,
  });

const codeOf = async (promise) => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    assert.ok(err instanceof ApiError, String(err));
    return err.code;
  }
};

test('parseStatuses: a JSON string of N, A, P, R, Y and spaces only', () => {
  assert.equal(parseStatuses('"  NAPRY"'), '  NAPRY');
  for (const bad of [
    '',
    'NNN',
    '"NNX"',
    '{"a":1}',
    '["N"]',
    '""',
    '"N\\nN"',
    JSON.stringify('N'.repeat(10001)),
  ]) {
    assert.throws(() => parseStatuses(bad), { code: 'unreadable' }, bad.slice(0, 20));
  }
});

test('levelOf: the level by UID, undefined when no data', () => {
  const s = statuses({ 3: 'P', 4: 'Y', 5: 'R', 8: 'A' });
  assert.deepEqual(
    [0, 3, 4, 5, 8, 9, 1805, 99999].map((uid) => levelOf(s, uid)),
    [undefined, 1, 2, 3, 3, 0, undefined, undefined],
  );
  assert.equal(levelOf(null, 3), undefined);
});

test('retryAfterMs: seconds, or a date against the Date header only', () => {
  const h = (o) => new Headers(o);
  assert.equal(retryAfterMs(h({ 'retry-after': '120' })), 120_000);
  assert.equal(retryAfterMs(h({})), null);
  assert.equal(retryAfterMs(h({ 'retry-after': 'soon' })), null);
  assert.equal(
    retryAfterMs(h({ 'retry-after': 'Wed, 11 Nov 2026 10:05:00 GMT' })),
    null,
    'no Date header: unknown, never "expired"',
  );
  assert.equal(
    retryAfterMs(
      h({ 'retry-after': 'Wed, 11 Nov 2026 10:05:00 GMT', date: 'Wed, 11 Nov 2026 10:00:00 GMT' }),
    ),
    300_000,
  );
});

test('fetchStatuses: what each answer means', async () => {
  const ok = await call(answer(statuses({ 31: 'R' })));
  assert.equal(levelOf(ok.statuses, 31), 3);
  assert.equal(ok.lastModified, 'Wed, 11 Nov 2026 09:59:00 GMT');
  assert.deepEqual(await call(new Response(null, { status: 304 })), { notModified: true });
  assert.equal(await codeOf(call(answer({ message: 'x' }, 401))), 'refused');
  assert.equal(await codeOf(call(answer({ message: 'x' }, 403))), 'denied');
  assert.equal(await codeOf(call(answer({ message: 'x' }, 429))), 'rate_limited');
  assert.equal(await codeOf(call(answer({ message: 'x' }, 500))), 'server');
  assert.equal(await codeOf(call(answer({ message: 'x' }, 404))), 'http');
  assert.equal(
    await codeOf(call(new Response(null, { status: 302, headers: { location: 'https://x/' } }))),
    'http',
    'a redirect is never followed',
  );
  assert.equal(await codeOf(call(answer({ not: 'a string' }))), 'unreadable');
  assert.equal(await codeOf(call(() => Promise.reject(new TypeError('x')))), 'network');
  assert.equal(
    await codeOf(call(new Response('x', { headers: { 'content-length': '999999' } }))),
    'too_large',
  );
  const hang = () => new Promise(() => {});
  assert.equal(await codeOf(call(hang, { timeoutMs: 20 })), 'timeout');
});

test('fetchStatuses: a body that never ends is cut by the timeout', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('"NN'));
    },
  });
  const code = await codeOf(
    fetchStatuses({
      token: 'tok',
      version: '0.1.0',
      timeoutMs: 30,
      fetchImpl: async (url, init) => {
        init.signal.addEventListener('abort', () => body.cancel().catch(() => {}));
        return new Response(body);
      },
    }),
  );
  assert.ok(['timeout', 'network'].includes(code), code);
});

test('fetchStatuses: the token goes to api.alerts.in.ua only', async () => {
  let sent = false;
  const code = await codeOf(
    fetchStatuses({
      token: 'tok',
      version: '0.1.0',
      timeoutMs: 100,
      url: 'https://evil.example/v2/iot/active_air_raid_alerts.json',
      fetchImpl: async () => {
        sent = true;
        return answer(statuses());
      },
    }),
  );
  assert.equal(code, 'http');
  assert.equal(sent, false);
});

test('a Last-Modified with a control character is not sent back', async () => {
  const r = await call(
    new Response(JSON.stringify('NN'), {
      headers: { 'last-modified': 'Wed, 11 Nov 2026 09:59:00 GMT\u0001' },
    }),
  ).catch((e) => e);
  assert.ok(r instanceof TypeError || r.lastModified === null);
});

test('tokenState and the configuration', () => {
  assert.equal(tokenState(''), 'missing');
  assert.equal(tokenState('abc'), 'ok');
  assert.equal(tokenState('a b'), 'invalid');
  assert.equal(tokenState('a\nb'), 'invalid');
  assert.equal(tokenState('é'), 'invalid');
  assert.equal(tokenState('x'.repeat(257)), 'invalid');
  const config = normalizeConfig({
    api_token: '  tok  ',
    locations: '31;14\n1293',
    read_interval: '5',
  });
  assert.equal(config.token, 'tok');
  assert.deepEqual(config.uids, [31, 14, 1293]);
  assert.equal(config.readInterval, 20);
  assert.equal(normalizeConfig({ read_interval: 99999 }).readInterval, 600);
  assert.equal(normalizeConfig({ read_interval: '' }).readInterval, 30);
  assert.equal(normalizeConfig({ read_interval: true }).readInterval, 30);
  assert.equal(normalizeConfig(undefined).tokenState, 'missing');
});

test('parseLocations: integers 1 to 9999, duplicates dropped, 20 at most, the rest told', () => {
  assert.deepEqual(parseLocations('31, 14, 31, 0, 10000, 1.5, -3, ab, 22'), {
    uids: [31, 14, 22],
    invalid: 5,
    dropped: 0,
  });
  const many = parseLocations(Array.from({ length: 25 }, (_, i) => i + 1).join(' '));
  assert.equal(many.uids.length, 20);
  assert.equal(many.dropped, 5);
  assert.deepEqual(parseLocations(undefined), { uids: [], invalid: 0, dropped: 0 });
});

test('the location names: oblasts with English, raions, an unknown UID', () => {
  assert.equal(LOCATIONS.size, 155);
  assert.equal(locationName(31), 'м. Київ (Kyiv)');
  assert.equal(locationName(42), 'Кам’янський район');
  assert.equal(locationName(1700), 'Location 1700');
  assert.equal(fold('Київ'), 'kyiv');
  assert.equal(fold('Кам’янський'), 'kamianskyi');
  assert.deepEqual(
    searchLocations('Odesa').map((l) => l.uid),
    [18],
  );
  assert.deepEqual(
    searchLocations('Одеськ').map((l) => l.uid),
    [18, 104],
  );
  assert.deepEqual(searchLocations('a'), []);
  assert.ok(searchLocations('район').length <= 15);
});

test('fetchStatuses: the token goes over https to api.alerts.in.ua only, no user nor port', async () => {
  for (const url of [
    'http://api.alerts.in.ua/v2/iot/active_air_raid_alerts.json',
    'https://api.alerts.in.ua.evil.com/v2/iot/active_air_raid_alerts.json',
    'https://x.alerts.in.ua/v2/iot/active_air_raid_alerts.json',
    'https://user@api.alerts.in.ua/v2/iot/active_air_raid_alerts.json',
    'https://user:pw@api.alerts.in.ua/v2/iot/active_air_raid_alerts.json',
    'https://api.alerts.in.ua:8443/v2/iot/active_air_raid_alerts.json',
  ]) {
    let sent = false;
    const code = await codeOf(
      fetchStatuses({
        token: 'tok',
        version: '0.1.0',
        timeoutMs: 100,
        url,
        fetchImpl: async () => {
          sent = true;
          return answer(statuses());
        },
      }),
    );
    assert.equal(code, 'http', url);
    assert.equal(sent, false, url);
  }
});

test('the tag of a refused token depends on its salt', () => {
  const token = 'TestToken0123456789abcdefABCDEF-xyz';
  const tags = new Set();
  for (let i = 0; i < 16; i += 1) tags.add(tagOf(String(i).padStart(32, '0'), token));
  assert.ok(tags.size > 1, 'the salt changes the tag');
  assert.ok(Number.isInteger(tagOf('a'.repeat(32), token)) && tagOf('a'.repeat(32), token) < 256);
});
