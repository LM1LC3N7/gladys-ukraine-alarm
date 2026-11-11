// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted alerts.in.ua and a
// virtual clock (the monotonic clock moves 1 µs per read, so that a decision
// reading it twice is caught).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { normalizeConfig } from '../../src/config.js';
import { registerHandlers } from '../../src/handlers.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'ukraine-alarm';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** 2026-11-11 10:00:00 UTC (12:00 in Kyiv). */
export const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
export const TOKEN = 'TestToken0123456789abcdefABCDEF-xyz';
export const CONFIG = { api_token: TOKEN, locations: '31, 14' };
export const F = (uid) => `ext:${SELECTOR}:location:${uid}:level`;
export const D = (uid) => `ext:${SELECTOR}:location:${uid}`;

/** A status string: 'N' everywhere (spaces at 0, 1, 2, 6, 7 and beyond 1804), `set` = { uid: char }. */
export function statuses(set = {}) {
  const chars = [];
  for (let uid = 0; uid <= 1804; uid += 1) {
    chars.push([0, 1, 2, 6, 7].includes(uid) ? ' ' : 'N');
  }
  for (const [uid, c] of Object.entries(set)) chars[Number(uid)] = c;
  return chars.join('');
}

export const answer = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' && status !== 200 ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'last-modified': 'Wed, 11 Nov 2026 09:59:00 GMT',
      ...headers,
    },
  });

/**
 * alerts.in.ua: `world(call, clock)` -> a Response, a status string (200),
 * 'hang' (never answers, until aborted), an Error (network) or undefined
 * (`net.current`, no alert anywhere at first).
 */
export function createNet(clock) {
  const net = {
    calls: [],
    current: statuses(),
    world: () => undefined,
    async fetch(url, init = {}) {
      const call = { url: new URL(url), init, at: clock.now };
      net.calls.push(call);
      const result = await net.world(call, clock);
      if (result === 'hang') {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
      }
      if (result instanceof Response) return result;
      if (result instanceof Error) throw result;
      return answer(result ?? net.current, 200, { date: new Date(clock.now).toUTCString() });
    },
    count: () => net.calls.length,
  };
  return net;
}

/** The devices of the configuration, as the user created them. */
export function createdDevices(config = CONFIG) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  return normalizeConfig(config).uids.map((uid) => buildDevice(gladys, uid));
}

export async function setup({
  config = CONFIG,
  devices = createdDevices(config),
  store = createMemoryStore(),
  now = NOW,
  wall = { offset: 0 },
  connect = true,
  requestTimeout = 50,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  const { clock, timers, advance, pending } = createFakeClock(now);
  let drift = 0;
  const net = createNet(clock);
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const app = new App({
    gladys,
    version: '0.1.0',
    fetchImpl: (...args) => net.fetch(...args),
    now: () => clock.now + wall.offset,
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    requestTimeout,
  });
  registerHandlers(gladys, app);
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const dueNow = () => [...pending.values()].some((timer) => timer.at <= clock.now);
  const wait = async (ms = 0) => {
    await flush();
    await advance(ms);
    await flush();
    for (let i = 0; i < 50 && dueNow(); i += 1) {
      await advance(0);
      await flush();
    }
  };
  if (connect) {
    await gladys.connect();
    await wait(0);
  }
  return { app, gladys, clock, net, store, wait, flush, advance, lines, pending, wall };
}

/** Wait (virtual time) until `predicate()` or fail after `max` ms. */
export async function until(env, predicate, { step = SECOND, max = 2 * HOUR } = {}) {
  for (let spent = 0; spent <= max; spent += step) {
    if (predicate()) return spent;
    await env.wait(step);
  }
  throw new Error('until: never true');
}

/** The scene events fired, as the fake Gladys keeps them. */
export const sceneEvents = (gladys) => gladys.fake.sceneEvents ?? [];
