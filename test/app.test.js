// -----------------------------------------------------------------------------
// The integration on the fake Gladys of the SDK, a scripted alerts.in.ua and
// a virtual clock that moves.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagOf } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import {
  answer,
  CONFIG,
  createdDevices,
  D,
  F,
  HOUR,
  MINUTE,
  NOW,
  SECOND,
  setup,
  statuses,
  TOKEN,
  until,
} from './helpers/world.js';

const said = (ack) => ack.data?.message?.en ?? ack.data?.en ?? String(ack.data ?? ack.error);
const text = (env) => env.gladys.fake.connectionStatus?.message?.en ?? '';
const events = (env, key) =>
  env.gladys.fake.sceneEvents.filter((e) => !key || e.key === key).map((e) => e.data);

test('first read at once, then once per interval, never sooner; levels published', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 1);
  assert.equal(env.gladys.fake.lastState(F(31)), 0);
  assert.equal(env.gladys.fake.lastState(F(14)), 0);
  await env.wait(29 * SECOND);
  assert.equal(env.net.count(), 1);
  await env.wait(1 * SECOND);
  assert.equal(env.net.count(), 2);
  await env.wait(10 * MINUTE);
  assert.equal(env.net.count(), 22);
  assert.equal(env.gladys.fake.connectionStatus.connected, true);
  assert.match(text(env), /Connected: 2 locations .*0 with an alert/);
});

test('the request: v2 statuses, token in the Authorization header only, own User-Agent, If-Modified-Since', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  await env.wait(30 * SECOND);
  const [first, second] = env.net.calls;
  assert.equal(first.url.href, 'https://api.alerts.in.ua/v2/iot/active_air_raid_alerts.json');
  assert.equal(first.url.search, '');
  assert.equal(first.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(first.init.headers.Accept, 'application/json');
  assert.match(
    first.init.headers['User-Agent'],
    /^gladys-ukraine-alarm\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-ukraine-alarm\)$/,
  );
  assert.equal(first.init.redirect, 'manual');
  assert.equal(first.init.headers['If-Modified-Since'], undefined);
  assert.equal(second.init.headers['If-Modified-Since'], 'Wed, 11 Nov 2026 09:59:00 GMT');
});

test('a 304 keeps the last levels and counts as a good read', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.current = statuses({ 31: 'R' });
  await env.wait(30 * SECOND);
  assert.equal(env.gladys.fake.lastState(F(31)), 3);
  env.net.world = () => new Response(null, { status: 304 });
  await env.wait(15 * MINUTE);
  assert.equal(env.gladys.fake.lastState(F(31)), 3);
  assert.equal(env.gladys.fake.connectionStatus.connected, true);
  assert.match(text(env), /1 with an alert/);
});

test('the four levels: N 0, P 1, Y 2, R 3; A (no level given) counts as red', async (t) => {
  const env = await setup({ config: { ...CONFIG, locations: '31, 14, 22, 23, 24' } });
  t.after(() => env.app.stop());
  env.net.current = statuses({ 31: 'N', 14: 'P', 22: 'Y', 23: 'R', 24: 'A' });
  await env.wait(30 * SECOND);
  assert.deepEqual(
    [31, 14, 22, 23, 24].map((uid) => env.gladys.fake.lastState(F(uid))),
    [0, 1, 2, 3, 3],
  );
  assert.match(text(env), /5 locations .*3 with an alert/);
});

test('no device created: no request at all; a device created: read at once', async (t) => {
  const env = await setup({ devices: [] });
  t.after(() => env.app.stop());
  await env.wait(10 * MINUTE);
  assert.equal(env.net.count(), 0);
  assert.match(text(env), /Discover tab/);
  assert.deepEqual(
    env.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [D(31), D(14)],
  );
  await env.gladys.fake.deviceCreated(createdDevices()[0]);
  await env.wait(0);
  assert.equal(env.net.count(), 1);
  assert.equal(env.gladys.fake.lastState(F(31)), 0);
  assert.equal(env.gladys.fake.lastState(F(14)), undefined);
});

test('nothing reads faster than the interval: save, reconnection, Discover, device created, test button', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 1);
  await env.gladys.fake.configUpdated({ ...CONFIG });
  await env.gladys.fake.scanRequest();
  await env.app.onConnected();
  await env.gladys.fake.deviceCreated(createdDevices()[1]);
  const ack = await env.gladys.fake.action('test_connection');
  await env.wait(15 * SECOND);
  assert.equal(env.net.count(), 1);
  assert.match(said(ack), /Last read \d+ s ago/);
  assert.match(said(ack), /м\. Київ \(Kyiv\) \[31\]: no alert/);
});

test('the test button reads once more than 20 s after the last request, and shows each level', async (t) => {
  const env = await setup({ config: { ...CONFIG, read_interval: 600 } });
  t.after(() => env.app.stop());
  env.net.current = statuses({ 14: 'Y' });
  await env.wait(25 * SECOND);
  const ack = await env.gladys.fake.action('test_connection');
  assert.equal(env.net.count(), 2);
  assert.match(said(ack), /Token accepted/);
  assert.match(said(ack), /Київська область \(Kyiv Oblast\) \[14\]: alert, yellow level/);
});

test('a restart reads no sooner than the interval: the attempt is in /data before the request', async (t) => {
  const store = createMemoryStore();
  const first = await setup({ store });
  let savedBefore = null;
  first.net.world = () => {
    savedBefore ??= store.data?.attempt?.at;
  };
  await first.wait(30 * SECOND);
  assert.ok(Math.abs(savedBefore - first.clock.now) < 1, `${savedBefore}`);
  await first.wait(10 * SECOND);
  await first.app.stop();
  const again = await setup({ store, now: first.clock.now });
  t.after(() => again.app.stop());
  assert.equal(again.net.count(), 0);
  await again.wait(19 * SECOND);
  assert.equal(again.net.count(), 0);
  await again.wait(1 * SECOND);
  assert.equal(again.net.count(), 1);
});

test('scene events: started (yellow), turned red, ended with its duration; partial fires nothing', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  assert.deepEqual(events(env), [], 'no event on the first read');
  env.net.current = statuses({ 31: 'P' });
  await env.wait(30 * SECOND);
  assert.deepEqual(events(env), []);
  env.net.current = statuses({ 31: 'Y' });
  await env.wait(30 * SECOND);
  env.net.current = statuses({ 31: 'R' });
  await env.wait(30 * SECOND);
  env.net.current = statuses({ 31: 'R' });
  await env.wait(9 * MINUTE);
  env.net.current = statuses({ 31: 'N' });
  await env.wait(30 * SECOND);
  const started = events(env, 'alert_started');
  assert.equal(started.length, 2);
  assert.deepEqual(started[0], {
    location: D(31),
    uid: 31,
    location_name: 'м. Київ (Kyiv)',
    late: false,
    level: 'yellow',
    escalated: false,
  });
  assert.equal(started[1].level, 'red');
  assert.equal(started[1].escalated, true);
  const ended = events(env, 'alert_ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].duration_minutes, 10);
  assert.equal(ended[0].location, D(31));
  assert.equal(ended[0].late, false);
});

test('red to yellow is no new start; yellow to partial is an end', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.current = statuses({ 14: 'N' });
  await env.wait(30 * SECOND);
  env.net.current = statuses({ 14: 'R' });
  await env.wait(30 * SECOND);
  env.net.current = statuses({ 14: 'Y' });
  await env.wait(30 * SECOND);
  env.net.current = statuses({ 14: 'P' });
  await env.wait(30 * SECOND);
  assert.deepEqual(
    env.gladys.fake.sceneEvents.map((e) => [e.key, e.data.level ?? e.data.duration_minutes]),
    [
      ['alert_started', 'red'],
      ['alert_ended', 1],
    ],
  );
});

test('after a restart, a change since the level kept in /data fires late; older than 2 h fires nothing', async (t) => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.wait(30 * SECOND);
  await first.app.stop();
  const again = await setup({ store, now: first.clock.now + 30 * MINUTE, connect: false });
  again.net.current = statuses({ 31: 'R' });
  await again.gladys.connect();
  await again.wait(0);
  await again.wait(30 * SECOND);
  await again.app.stop();
  const started = again.gladys.fake.sceneEvents.filter((e) => e.key === 'alert_started');
  assert.equal(started.length, 1);
  assert.equal(started[0].data.late, true);
  // Three hours later: the level kept is too old to compare.
  const later = await setup({ store, now: again.clock.now + 3 * HOUR });
  t.after(() => later.app.stop());
  later.net.current = statuses({ 31: 'N' });
  await later.wait(30 * SECOND);
  assert.equal(later.net.count() >= 1, true);
  assert.deepEqual(later.gladys.fake.sceneEvents, []);
});

test('a location without data (a space) gets no state and is named in the status', async (t) => {
  const env = await setup({ config: { ...CONFIG, locations: '31, 7' } });
  t.after(() => env.app.stop());
  await env.wait(0);
  assert.equal(env.gladys.fake.lastState(F(31)), 0);
  assert.equal(env.gladys.fake.lastState(F(7)), undefined);
  assert.match(text(env), /No data for the UID 7/);
});

test('a refused token (401): automatic reads stop, /data keeps a tag, never the token; a new token is tried', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  env.net.world = () => answer({ message: 'Unauthorized' }, 401);
  await env.wait(30 * SECOND);
  assert.equal(env.net.count(), 2);
  await env.wait(HOUR);
  assert.equal(env.net.count(), 2);
  assert.match(text(env), /refused the token \(HTTP 401\)/);
  assert.equal(env.gladys.fake.connectionStatus.connected, false);
  const saved = JSON.stringify(store.data);
  assert.ok(!saved.includes(TOKEN));
  assert.ok(!saved.includes(TOKEN.slice(0, 8)));
  assert.match(saved, /"refused":\{"salt":"[0-9a-f]{32}","tag":\d+,"status":401\}/);
  await env.app.stop();
  // The same token after a restart: still refused, nothing sent.
  const again = await setup({ store, now: env.clock.now });
  await again.wait(HOUR);
  assert.equal(again.net.count(), 0);
  // A new token: read at once.
  await again.gladys.fake.configUpdated({ ...CONFIG, api_token: 'AnotherToken987654321' });
  await again.wait(0);
  t.after(() => again.app.stop());
  assert.equal(again.net.count(), 1);
  assert.equal(again.net.calls[0].init.headers.Authorization, 'Bearer AnotherToken987654321');
  assert.match(text(again), /Connected/);
  assert.equal(store.data.refused, null);
});

test('a refused token: the test button tries it again (once per click) and lifts the refusal on success', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => answer({ message: 'Unauthorized' }, 401);
  await env.wait(30 * SECOND);
  await env.wait(MINUTE);
  const refused = await env.gladys.fake.action('test_connection');
  assert.match(said(refused), /refused the token/);
  assert.equal(env.net.count(), 3);
  env.net.world = () => undefined;
  const again = await env.gladys.fake.action('test_connection');
  assert.equal(env.net.count(), 3, 'no request sooner than 20 s');
  assert.match(said(again), /refused the token/);
  await env.wait(20 * SECOND);
  const ok = await env.gladys.fake.action('test_connection');
  assert.match(said(ok), /Token accepted/);
  await env.wait(30 * SECOND);
  assert.equal(env.net.count(), 5, 'automatic reads again');
});

test('a 403 is no refusal: 30 min pause, doubled, kept in /data', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  t.after(() => env.app.stop());
  env.net.world = () => answer({ message: 'Forbidden' }, 403);
  await env.wait(30 * SECOND);
  assert.equal(env.net.count(), 2);
  assert.match(text(env), /refused this address \(HTTP 403/);
  assert.equal(store.data.refused, null);
  assert.equal(store.data.pause.kind, 'denied');
  await env.wait(29 * MINUTE);
  assert.equal(env.net.count(), 2);
  await env.wait(MINUTE + SECOND);
  assert.equal(env.net.count(), 3);
  await env.wait(59 * MINUTE);
  assert.equal(env.net.count(), 3, 'the second pause lasts an hour');
  env.net.world = () => undefined;
  await until(env, () => env.net.count() === 4, { max: 2 * MINUTE });
  assert.match(text(env), /Connected/);
});

test('429: Retry-After honoured, bounded to 1 min to 6 h, kept across a restart', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  env.net.world = () => answer({ message: 'Too many' }, 429, { 'retry-after': '5' });
  await env.wait(30 * SECOND);
  assert.equal(env.net.count(), 2);
  await env.wait(59 * SECOND);
  assert.equal(env.net.count(), 2, 'never shorter than a minute');
  assert.match(text(env), /Too many requests \(HTTP 429\)/);
  await env.wait(2 * SECOND);
  assert.equal(env.net.count(), 3);
  env.net.world = () => answer({ message: 'Too many' }, 429, { 'retry-after': '999999' });
  await env.wait(MINUTE + SECOND);
  const count = env.net.count();
  await env.app.stop();
  const again = await setup({ store, now: env.clock.now + HOUR });
  t.after(() => again.app.stop());
  await again.wait(4 * HOUR);
  assert.equal(again.net.count(), 0, 'the pause survives the restart');
  const spent = await until(again, () => again.net.count() >= 1, { max: 2 * HOUR });
  assert.ok(spent <= HOUR + MINUTE, 'six hours at most');
  assert.ok(count >= 4);
});

test('429 with a Retry-After date: compared with the Date of the answer, not the local clock', async (t) => {
  const env = await setup({ wall: { offset: -2 * HOUR } });
  t.after(() => env.app.stop());
  const date = new Date(NOW + 30 * SECOND);
  env.net.world = () =>
    answer({ message: 'Too many' }, 429, {
      date: date.toUTCString(),
      'retry-after': new Date(NOW + 30 * SECOND + 10 * MINUTE).toUTCString(),
    });
  await env.wait(30 * SECOND);
  env.net.world = () => undefined;
  await env.wait(10 * MINUTE - SECOND);
  assert.equal(env.net.count(), 2);
  await env.wait(2 * SECOND);
  assert.equal(env.net.count(), 3);
});

test('a failing read (5xx, timeout, network, unreadable, cut) is no refusal: retried later and later, up to 15 min', async (t) => {
  for (const failure of [
    () => answer({ message: 'boom' }, 500),
    () => new TypeError('fetch failed'),
    () => answer({ not: 'a string' }),
    () => answer('NNNXNN'),
    () => answer('N'.repeat(70_000)),
  ]) {
    const store = createMemoryStore();
    const env = await setup({ store, devices: [] });
    t.after(() => env.app.stop());
    env.net.world = failure;
    await env.gladys.fake.deviceCreated(createdDevices()[0]);
    await env.wait(0);
    const at = [];
    env.net.world = (call) => {
      at.push(call.at);
      return failure();
    };
    await env.wait(2 * HOUR);
    const gaps = at.map((a, i) => (i === 0 ? null : Math.round((a - at[i - 1]) / SECOND))).slice(1);
    assert.deepEqual(gaps.slice(0, 6), [60, 120, 240, 480, 900, 900], String(failure));
    assert.equal(store.data.refused, null);
    assert.equal(env.app.pause, null);
    assert.equal(env.gladys.fake.connectionStatus.connected, false);
    assert.match(text(env), /could not be read/);
    await env.app.stop();
  }
});

test('a request that never answers is cut by its timeout and retried later, no refusal', async (t) => {
  const env = await setup({ devices: [], requestTimeout: 20 });
  t.after(() => env.app.stop());
  env.net.world = () => 'hang';
  await env.gladys.fake.deviceCreated(createdDevices()[0]);
  await env.wait(0);
  assert.equal(env.net.count(), 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await env.wait(0);
  assert.match(text(env), /could not be read \(timeout\)/);
  assert.equal(env.app.refused, null);
  env.net.world = () => undefined;
  await env.wait(MINUTE);
  assert.ok(env.net.count() >= 2);
  assert.match(text(env), /Connected/);
});

test('a body larger than 64 KB is cut, never read to its end', async (t) => {
  const env = await setup({ devices: [] });
  t.after(() => env.app.stop());
  let pulled = 0;
  env.net.world = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(16 * 1024).fill(0x4e));
          if (pulled > 100) controller.close();
        },
      }),
      { status: 200 },
    );
  await env.gladys.fake.deviceCreated(createdDevices()[0]);
  await env.wait(0);
  assert.ok(pulled <= 7, `${pulled} chunks pulled`);
  assert.match(text(env), /too_large/);
});

test('the status says the levels are not recent 10 min after the last good read', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => answer({ message: 'boom' }, 503);
  await env.wait(9 * MINUTE);
  assert.doesNotMatch(text(env), /not recent/);
  await env.wait(2 * MINUTE);
  assert.match(text(env), /No good read since 12:00: the levels shown are not recent/);
});

test('a late answer of the old token publishes nothing; the new token reads', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  const held = [];
  env.net.world = ({ init }) =>
    init.headers.Authorization === `Bearer ${TOKEN}`
      ? new Promise((resolve) => held.push(resolve))
      : undefined;
  await env.gladys.connect();
  await env.wait(0);
  assert.equal(held.length, 1);
  env.net.world = () => undefined;
  await env.gladys.fake.configUpdated({ ...CONFIG, api_token: 'NewToken1234567890' });
  await env.wait(0);
  held[0](answer(statuses({ 31: 'R' })));
  await env.wait(0);
  assert.equal(env.gladys.fake.lastState(F(31)), 0);
  assert.equal(
    env.gladys.fake
      .bodies('POST', '/state')
      .flatMap((b) => b.states)
      .some((s) => s.state === 3),
    false,
  );
  assert.equal(env.net.calls.at(-1).init.headers.Authorization, 'Bearer NewToken1234567890');
  assert.ok(
    env.gladys.fake.connectionStatuses.every(
      (s) => !/[1-9] with an alert/.test(s.message?.en ?? ''),
    ),
  );
});

test('getConfig failing in "connected": retried later and later, status told, then recovered', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  const real = env.gladys.getConfig.bind(env.gladys);
  let failures = 2;
  let calls = 0;
  env.gladys.getConfig = async () => {
    calls += 1;
    // The first call is the SDK's own resynchronization in connect().
    if (calls > 1 && failures > 0) {
      failures -= 1;
      throw new Error('Gladys busy');
    }
    return real();
  };
  await env.gladys.connect();
  await env.wait(0);
  assert.match(text(env), /could not be read from Gladys/);
  assert.equal(env.net.count(), 0);
  await env.wait(5 * SECOND);
  assert.equal(failures, 0);
  assert.equal(env.net.count(), 0);
  await env.wait(10 * SECOND);
  assert.equal(env.net.count(), 1);
  assert.match(text(env), /Connected/);
});

test('/data unreadable: read again every 10 s, never overwritten; after 3 failures the reads go on in memory', async (t) => {
  const store = createMemoryStore({ attempt: { at: NOW - 10 * SECOND, failures: 0 } });
  store.failLoad = 5;
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 0);
  assert.match(text(env), /\/data\) cannot be read yet/);
  await env.wait(19 * SECOND);
  assert.equal(env.net.count(), 0);
  assert.equal(store.saves, 0);
  await env.wait(2 * SECOND);
  assert.equal(env.net.count(), 1, 'in memory after the third failed load');
  assert.equal(store.saves, 0, 'nothing written over /data');
  await env.wait(30 * SECOND);
  assert.ok(store.saves > 0, 'written once read');
});

test('a wall clock set back or forward neither stops nor hurries the reads', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.wall.offset = -3 * HOUR;
  await env.wait(30 * SECOND);
  assert.equal(env.net.count(), 2);
  env.wall.offset = 5 * HOUR;
  await env.wait(29 * SECOND);
  assert.equal(env.net.count(), 2);
  await env.wait(SECOND);
  assert.equal(env.net.count(), 3);
});

test('the token is never in the logs, the statuses, /data nor the scene events', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  t.after(() => env.app.stop());
  const worlds = [
    () => answer({ message: `bad token ${TOKEN}` }, 401),
    () => new TypeError(`fetch failed for ${TOKEN}`),
    () => answer(statuses({ 31: 'R' })),
  ];
  for (const world of worlds) {
    env.net.world = world;
    await env.gladys.fake.action('test_connection');
    await env.wait(MINUTE);
  }
  const everything = JSON.stringify([
    env.lines,
    env.gladys.fake.connectionStatuses,
    env.gladys.fake.sceneEvents,
    store.data,
  ]);
  assert.ok(!everything.includes(TOKEN));
  assert.ok(!everything.includes(TOKEN.slice(0, 12)));
});

test('token missing or malformed: nothing sent, the status says what to do', async (t) => {
  for (const [token, message] of [
    ['', /No token/],
    ['two words', /spaces or characters/],
    ['abc\r\nX-Evil: 1', /spaces or characters/],
  ]) {
    const env = await setup({ config: { ...CONFIG, api_token: token } });
    t.after(() => env.app.stop());
    await env.wait(5 * MINUTE);
    assert.equal(env.net.count(), 0);
    assert.match(text(env), message);
    const ack = await env.gladys.fake.action('test_connection');
    assert.match(said(ack), message);
    assert.equal(env.net.count(), 0);
    await env.app.stop();
  }
});

test('locations: invalid entries and the 21st are told, duplicates dropped', async (t) => {
  const many = Array.from({ length: 22 }, (_, i) => 3 + i).join(',');
  const env = await setup({ config: { ...CONFIG, locations: `31, 31, abc, ${many}` } });
  t.after(() => env.app.stop());
  assert.equal(env.gladys.fake.discoveredDevices.length, 20);
  assert.match(text(env), /1 entry of the locations ignored: not a UID/);
  assert.match(text(env), /3 more locations ignored: 20 at most/);
});

test('no location: the status asks for one; nothing sent', async (t) => {
  const env = await setup({ config: { api_token: TOKEN, locations: '' }, devices: [] });
  t.after(() => env.app.stop());
  await env.wait(MINUTE);
  assert.equal(env.net.count(), 0);
  assert.match(text(env), /No location/);
});

test('"Find a location": UIDs by Ukrainian or Latin name, no request', async (t) => {
  const env = await setup({ devices: [] });
  t.after(() => env.app.stop());
  const kharkiv = said(await env.gladys.fake.action('find_location', { query: 'Kharkiv' }));
  assert.match(kharkiv, /^22: Харківська область \(Kharkiv Oblast\)$/m);
  assert.match(kharkiv, /^1293: м\. Харків \(Kharkiv\)$/m);
  assert.match(kharkiv, /^124: Харківський район$/m);
  const lviv = said(await env.gladys.fake.action('find_location', { query: 'Львівськ' }));
  assert.match(lviv, /^27: /m);
  assert.match(lviv, /^90: Львівський район$/m);
  assert.match(said(await env.gladys.fake.action('find_location', { query: 'x' })), /two letters/);
  assert.match(
    said(await env.gladys.fake.action('find_location', { query: 'Atlantis' })),
    /Nothing found/,
  );
  assert.equal(env.net.count(), 0);
});

test('reconnection: nothing old republished as new; a fresh read is', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.current = statuses({ 31: 'R' });
  await env.wait(30 * SECOND);
  env.net.world = () => 'hang';
  await env.wait(5 * MINUTE);
  const before = env.gladys.fake.bodies('POST', '/state').length;
  env.app.setLinked(false);
  env.app.setLinked(true);
  await env.app.onConnected();
  await env.wait(0);
  assert.equal(env.gladys.fake.bodies('POST', '/state').length, before);
  await until(env, () => env.gladys.fake.bodies('POST', '/state').length > before, {
    max: 10 * MINUTE,
  }).catch(() => {});
  assert.equal(env.gladys.fake.bodies('POST', '/state').length, before, 'the API still hangs');
});

test('stop: no timer left, no request after it', async () => {
  const env = await setup();
  await env.app.stop();
  const count = env.net.count();
  await env.wait(HOUR);
  assert.equal(env.net.count(), count);
  assert.equal(env.pending.size, 0);
});

test('a refusal kept in /data is not applied to another token after a restart', async (t) => {
  const salt = '0123456789abcdef0123456789abcdef';
  const other = 'OtherToken0123456789';
  assert.notEqual(tagOf(salt, other), tagOf(salt, TOKEN));
  const store = createMemoryStore({ refused: { salt, tag: tagOf(salt, TOKEN), status: 401 } });
  const same = await setup({ store });
  await same.wait(MINUTE);
  assert.equal(same.net.count(), 0, 'the same token stays refused');
  await same.app.stop();
  const env = await setup({ store, config: { ...CONFIG, api_token: other } });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 1);
  assert.match(text(env), /Connected/);
});

test('after an outage longer than 2 h, the first good read fires no event', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => answer({ message: 'boom' }, 503);
  await env.wait(2 * HOUR + 30 * MINUTE);
  env.net.world = () => undefined;
  env.net.current = statuses({ 31: 'R' });
  await until(env, () => env.gladys.fake.lastState(F(31)) === 3, { max: 20 * MINUTE });
  assert.deepEqual(env.gladys.fake.sceneEvents, []);
  env.net.current = statuses({ 31: 'N' });
  await env.wait(30 * SECOND);
  assert.equal(env.gladys.fake.sceneEvents.length, 1, 'the next change fires again');
});

test('a read overtaken while in flight (whatever the cause) publishes nothing', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  const held = [];
  env.net.world = () => new Promise((resolve) => held.push(resolve));
  await env.wait(30 * SECOND);
  assert.equal(held.length, 1);
  env.app.generation += 1;
  held[0](answer(statuses({ 31: 'R' })));
  await env.wait(0);
  assert.equal(env.gladys.fake.lastState(F(31)), 0);
  assert.deepEqual(env.gladys.fake.sceneEvents, []);
});

test('a token pasted in the locations by mistake is never shown nor logged, not even in part', async (t) => {
  const pasted = 'abcDEF123456789ghiJKL0987654321';
  const env = await setup({ config: { ...CONFIG, locations: `31, ${pasted}` } });
  t.after(() => env.app.stop());
  await env.wait(MINUTE);
  const seen = JSON.stringify([env.lines, env.gladys.fake.connectionStatuses]);
  for (let i = 0; i + 4 <= pasted.length; i += 1) {
    assert.ok(!seen.includes(pasted.slice(i, i + 4)), pasted.slice(i, i + 4));
  }
  assert.match(text(env), /1 entry of the locations ignored/);
});

test('the test button is atomic: three clicks at the same moment send one request', async (t) => {
  const env = await setup({ config: { ...CONFIG, read_interval: 600 } });
  t.after(() => env.app.stop());
  await env.wait(25 * SECOND);
  assert.equal(env.net.count(), 1);
  const acks = await Promise.all([
    env.app.testConnection(),
    env.app.testConnection(),
    env.app.testConnection(),
  ]);
  assert.equal(env.net.count(), 2);
  for (const ack of acks) assert.match(ack.en, /Token accepted/);
});

test('the token changed while the attempt is written to /data: one request, with the new token', async (t) => {
  const store = createMemoryStore();
  const save = store.save.bind(store);
  let hold = null;
  store.save = (data) => (hold ? hold.then(() => save(data)) : save(data));
  const env = await setup({ store, config: { ...CONFIG, read_interval: 600 } });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 1);
  await env.wait(25 * SECOND);
  let release;
  hold = new Promise((resolve) => (release = resolve));
  const test = env.app.testConnection();
  await env.flush();
  assert.equal(env.net.count(), 1, 'the attempt is being written');
  await env.gladys.fake.configUpdated({
    ...CONFIG,
    read_interval: 600,
    api_token: 'NewToken1234567890',
  });
  release();
  hold = null;
  await test;
  await env.wait(0);
  assert.equal(env.net.count(), 2);
  assert.equal(env.net.calls[1].init.headers.Authorization, 'Bearer NewToken1234567890');
});

test('a pause read from /data is capped to 6 h, whatever its end says', async (t) => {
  const store = createMemoryStore({
    pause: { kind: 'rate', until: NOW + 30 * 24 * HOUR, count: 1 },
  });
  const env = await setup({ store });
  t.after(() => env.app.stop());
  await env.wait(5 * HOUR);
  assert.equal(env.net.count(), 0);
  const spent = await until(env, () => env.net.count() >= 1, { max: 2 * HOUR });
  assert.ok(spent <= HOUR + MINUTE);
});

test('/data values that cannot be ours are ignored: refusal not 401, attempt in the future', async (t) => {
  const store = createMemoryStore({
    refused: {
      salt: '0123456789abcdef0123456789abcdef',
      tag: tagOf('0123456789abcdef0123456789abcdef', TOKEN),
      status: 403,
    },
    attempt: { at: NOW + 2 * HOUR, failures: 0 },
  });
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 1);
});

test('a wall clock jump between two reads does not age the levels: the alert still fires', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.wall.offset = 3 * HOUR;
  env.net.current = statuses({ 31: 'Y' });
  await env.wait(30 * SECOND);
  const started = events(env, 'alert_started');
  assert.equal(started.length, 1);
  assert.equal(started[0].late, false);
  env.wall.offset = -5 * HOUR;
  env.net.current = statuses({ 31: 'N' });
  await env.wait(30 * SECOND);
  assert.equal(events(env, 'alert_ended')[0].duration_minutes, 1);
});

test('the levels are in /data before the events fire: a restart does not fire them again', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  let savedLevel = null;
  const publish = env.gladys.publishSceneEvent.bind(env.gladys);
  env.gladys.publishSceneEvent = (key, data) => {
    savedLevel = store.data.levels['31'].level;
    return publish(key, data);
  };
  env.net.current = statuses({ 31: 'R' });
  await env.wait(30 * SECOND);
  assert.equal(savedLevel, 3);
  await env.app.stop();
  const again = await setup({ store, now: env.clock.now + MINUTE, connect: false });
  t.after(() => again.app.stop());
  again.net.current = statuses({ 31: 'R' });
  await again.gladys.connect();
  await again.wait(MINUTE);
  assert.deepEqual(again.gladys.fake.sceneEvents, []);
});

test('a 304 without a previous answer is not taken as data', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  env.net.world = () => new Response(null, { status: 304 });
  await env.gladys.connect();
  await env.wait(0);
  assert.equal(env.net.calls[0].init.headers['If-Modified-Since'], undefined);
  assert.match(text(env), /could not be read \(unreadable\)/);
  assert.equal(env.gladys.fake.lastState(F(31)), undefined);
});

test('a click and a loop read of the same moment: one request, the click answers from it', async (t) => {
  const env = await setup({ config: { ...CONFIG, read_interval: 600 } });
  t.after(() => env.app.stop());
  await env.wait(25 * SECOND);
  const loop = env.app.exclusive(() => env.app.read());
  const ack = await env.app.testConnection();
  await loop;
  assert.equal(env.net.count(), 2);
  assert.match(ack.en, /Last read \d+ s ago/);
});

test('a click while a read hangs answers at once from the last one, without waiting for it', async (t) => {
  const env = await setup({ config: { ...CONFIG, read_interval: 30 }, requestTimeout: 60_000 });
  t.after(() => env.app.stop());
  const held = [];
  env.net.world = () => new Promise((resolve) => held.push(resolve));
  await env.wait(30 * SECOND);
  assert.equal(held.length, 1);
  let answered = null;
  env.app.testConnection().then((a) => (answered = a));
  await env.flush();
  assert.match(answered?.en ?? '', /Last read \d+ s ago/);
  held[0](answer(statuses()));
  await env.wait(0);
});
