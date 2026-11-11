// -----------------------------------------------------------------------------
// The integration itself: the air raid status of every location of Ukraine,
// read from alerts.in.ua in ONE request per interval (one request in flight
// at a time for the token), the level of each location of the configuration
// published on the devices the user created, the scene events fired on each
// change, the pauses, the failures and the refused token kept in /data.
// index.js only wires the SDK handlers to it. Read-only: nothing is ever sent
// but GET requests.
//
// The pace survives everything: a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container (the
// time of each attempt is written to /data before the request). A 429 pauses
// every read (Retry-After, else 1 min doubling, between 1 min and 6 h); a 403
// (address blocked, country not served) 30 min doubling up to 6 h; any other
// failure (5xx, timeout, network, an answer cut or unreadable) is retried
// later and later (the interval doubling up to 15 min). A token refused (401)
// stops every automatic read until the token changes or the test button reads
// with success. A 403, an unreadable answer or a timeout is never a refusal.
//
// A read belongs to its configuration: when the token changes, a late answer
// of the old one publishes nothing and sets no status (generation checked
// after every await).
//
// Two clocks: `now` (wall clock) only dates what /data keeps and what the
// statuses say; `monotonic` paces the reads, the pauses and the freshness, so
// that a wall clock set back or forward never stops nor hurries them. One read
// of a clock per decision.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ApiError, fetchStatuses, levelOf } from './api.js';
import { normalizeConfig } from './config.js';
import {
  BACKOFF_MAX,
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  DENIED_PAUSE,
  EVENT_MEMORY,
  LEVEL,
  LEVEL_NAMES,
  MAX_EVENTS_PER_MINUTE,
  MAX_LOCATIONS,
  MAX_UID,
  MINUTE,
  PAUSE_MAX,
  PAUSE_MIN,
  REQUEST_TIMEOUT,
  SAVE_WAIT,
  STALE_AFTER,
  STORE_LOADS_BEFORE_MEMORY,
  STORE_RETRY,
  TEST_SPACING,
} from './constants.js';
import { buildDevice, idsOf, levelState } from './devices.js';
import { SCENE_TRIGGERS } from './handlers.js';
import { SEARCH, STATUS, TEST } from './i18n.js';
import { locationName, searchLocations } from './locations.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };
const MAX_STATUS = 1000;
const STATE_HEARTBEAT = 60 * MINUTE;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isAlert = (level) => level >= LEVEL.YELLOW;

/**
 * The tag of a refused token: 8 bits of a salted hash, never more (the token
 * cannot be found back from /data). Two tokens share it once in 256: the test
 * button then reads anyway, and a token changed while the integration runs is
 * compared in full (in memory only).
 */
export const tagOf = (salt, token) =>
  createHash('sha256').update(`${salt}\u0000${token}`, 'utf8').digest()[0];

const join = (messages) => ({
  en: messages
    .map((m) => m.en)
    .join(' ')
    .slice(0, MAX_STATUS),
  fr: messages
    .map((m) => m.fr)
    .join(' ')
    .slice(0, MAX_STATUS),
});

export class App {
  constructor({
    gladys,
    version,
    fetchImpl = (...args) => fetch(...args),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    store = createFileStore(),
    logger = createLogger({ name: 'ukraine-alarm' }),
    random = randomBytes,
    requestTimeout = REQUEST_TIMEOUT,
  }) {
    Object.assign(this, { gladys, version, fetchImpl, now, monotonic, timers, store, logger });
    this.random = random;
    this.requestTimeout = requestTimeout;
    this.config = normalizeConfig({});
    this.generation = 0;
    this.running = false;
    this.linked = false;
    this.storeState = 'pending';
    this.loadFailures = 0;
    this.loading = false;
    this.storeTimer = null;
    this.memoryTimer = null;
    this.tickTimer = null;
    this.staleTimer = null;
    this.configTimer = null;
    /** { kind: 'rate' | 'denied', until (wall), due (monotonic), count } */
    this.pause = null;
    /** { salt, tag, status, token? }: token only in memory, for this run. */
    this.refused = null;
    this.failures = 0;
    this.lastError = null;
    this.nextDue = -Infinity;
    this.attemptMono = null;
    /** The attempt kept in /data: { at (wall), failures }. */
    this.kept = null;
    /** The last status string read, with its Last-Modified and when (both clocks). */
    this.statuses = null;
    this.lastModified = null;
    this.readingMono = null;
    this.readingAt = null;
    /** uid -> { level, at (wall), since (wall | null) }: the last level of each location. */
    this.levels = new Map();
    this.events = [];
    this.chain = Promise.resolve();
    this.inflight = null;
    this.reading = false;
    this.lastStatus = null;
    this.connectSeq = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Start with a raw configuration; /data is read on its own timer. */
  start(rawConfig) {
    this.running = true;
    this.applyConfig(rawConfig);
    // /data that never answers: after a while, the reads go on in memory.
    this.memoryTimer = this.timers.setTimeout(() => {
      this.memoryTimer = null;
      if (this.storeState === 'pending') {
        this.logger.warn('/data did not answer: going on with the state in memory');
        this.storeState = 'memory';
        this.schedule();
        this.reportStatus();
      }
    }, STORE_RETRY * STORE_LOADS_BEFORE_MEMORY);
    this.loadStore();
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    this.connectSeq += 1;
    for (const name of ['tickTimer', 'storeTimer', 'memoryTimer', 'configTimer', 'staleTimer']) {
      if (this[name] !== null) {
        this.timers.clearTimeout(this[name]);
        this[name] = null;
      }
    }
    this.inflight?.abort();
    // The read in flight ends at once (aborted): waited at most 2 s, on a
    // real timer that never keeps the process alive.
    let timer;
    await Promise.race([
      this.chain,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2000);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }

  /** Gladys reachable or not: no read is spent while nothing can be published. */
  setLinked(linked) {
    this.linked = linked;
    if (linked) {
      this.gladys.forgetPublishedStates?.();
      this.lastStatus = null;
    }
    this.schedule();
  }

  /**
   * `connected`: read the configuration, retried later and later without
   * end, the status saying so; then apply it, publish the devices and the
   * status. A newer `connected` cancels an older loop.
   */
  async onConnected() {
    const seq = (this.connectSeq += 1);
    let wait = CONFIG_RETRY_MIN;
    for (;;) {
      try {
        const raw = await this.gladys.getConfig();
        if (seq !== this.connectSeq) {
          return;
        }
        if (!this.running) {
          this.start(raw);
        } else {
          this.applyConfig(raw);
        }
        this.setLinked(true);
        await this.publishDevices();
        await this.publishFresh();
        await this.reportStatus();
        return;
      } catch (err) {
        if (seq !== this.connectSeq) {
          return;
        }
        this.logger.warn(`Reading the configuration failed: ${err?.message ?? err}`);
        await this.gladys.setConnectionStatus(false, STATUS.configRetry).catch(() => {});
        this.lastStatus = null;
        await new Promise((resolve) => {
          this.configTimer = this.timers.setTimeout(() => {
            this.configTimer = null;
            resolve();
          }, wait);
        });
        if (seq !== this.connectSeq) {
          return;
        }
        wait = Math.min(CONFIG_RETRY_MAX, wait * 2);
      }
    }
  }

  /** A new configuration (the form saved). */
  async onConfigUpdated(raw) {
    this.applyConfig(raw);
    await this.publishDevices();
    await this.publishFresh();
    await this.reportStatus();
  }

  applyConfig(raw) {
    const previous = this.config;
    const next = normalizeConfig(raw);
    this.config = next;
    if (next.token !== previous.token) {
      this.generation += 1;
      this.inflight?.abort();
      // A new token is always tried: compared in full when it was refused in
      // this run, by its tag when the refusal comes from /data.
      if (this.refused && !this.refusalMatches(next.token)) {
        this.logger.info('The token changed: the refusal is lifted');
        this.refused = null;
        this.saveSoon();
      }
      // Read at once with the new token (a pause still holds).
      this.failures = 0;
      this.lastError = null;
      this.nextDue = -Infinity;
      this.lastModified = null;
    } else if (this.attemptMono !== null) {
      this.nextDue = this.attemptMono + this.waitAfter(this.failures);
    }
    if (next.droppedLocations > 0) {
      this.logger.warn(`${next.droppedLocations} locations ignored: ${MAX_LOCATIONS} at most`);
    }
    this.schedule();
  }

  refusalMatches(token) {
    if (!this.refused || !token) {
      return false;
    }
    return this.refused.token !== undefined
      ? this.refused.token === token
      : tagOf(this.refused.salt, token) === this.refused.tag;
  }

  // --- /data -----------------------------------------------------------------

  async loadStore() {
    if (this.loading || !this.running) {
      return;
    }
    this.loading = true;
    try {
      const data = await this.store.load();
      if (!this.running) {
        return;
      }
      this.restore(data);
      const wasMemory = this.storeState === 'memory';
      this.storeState = 'ok';
      this.loadFailures = 0;
      if (wasMemory) {
        this.saveSoon();
      }
    } catch (err) {
      this.loadFailures += 1;
      this.logger.warn(`/data unreadable (${err?.message ?? err}): read again in 10 s`);
      if (this.storeState === 'pending' && this.loadFailures >= STORE_LOADS_BEFORE_MEMORY) {
        this.storeState = 'memory';
      }
      if (this.running) {
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          return this.loadStore();
        }, STORE_RETRY);
      }
    } finally {
      this.loading = false;
    }
    if (this.storeState !== 'pending' && this.memoryTimer !== null) {
      this.timers.clearTimeout(this.memoryTimer);
      this.memoryTimer = null;
    }
    this.schedule();
    await this.reportStatus();
  }

  /** Take what /data keeps, the stricter of it and of memory, every value checked. */
  restore(data) {
    const now = this.now();
    const mono = this.monotonic();
    const pause = data?.pause;
    if (
      pause &&
      (pause.kind === 'rate' || pause.kind === 'denied') &&
      finite(pause.until) &&
      Number.isInteger(pause.count) &&
      pause.count >= 1 &&
      pause.count <= 32
    ) {
      const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
      if (left > 0 && (!this.pause || mono + left > this.pause.due)) {
        this.pause = { kind: pause.kind, until: now + left, due: mono + left, count: pause.count };
      }
    }
    const refused = data?.refused;
    if (
      !this.refused &&
      refused &&
      typeof refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(refused.salt) &&
      Number.isInteger(refused.tag) &&
      refused.tag >= 0 &&
      refused.tag < 256 &&
      refused.status === 401
    ) {
      const candidate = { salt: refused.salt, tag: refused.tag, status: refused.status };
      if (!this.config.token || tagOf(candidate.salt, this.config.token) === candidate.tag) {
        this.refused = candidate;
      }
    }
    const attempt = data?.attempt;
    if (
      attempt &&
      finite(attempt.at) &&
      attempt.at <= now + MINUTE &&
      Number.isInteger(attempt.failures) &&
      attempt.failures >= 0 &&
      attempt.failures <= 20 &&
      this.attemptMono === null &&
      (!this.kept || this.kept.at < attempt.at)
    ) {
      this.kept = { at: attempt.at, failures: attempt.failures };
      this.failures = attempt.failures;
      const wait = this.waitAfter(attempt.failures);
      this.nextDue = mono + Math.min(wait, Math.max(0, attempt.at + wait - now));
    }
    const levels = data?.levels;
    if (levels && typeof levels === 'object' && !Array.isArray(levels)) {
      for (const [key, entry] of Object.entries(levels)) {
        const uid = /^\d{1,4}$/.test(key) ? Number(key) : 0;
        if (
          uid < 1 ||
          uid > MAX_UID ||
          this.levels.has(uid) ||
          !entry ||
          !Number.isInteger(entry.level) ||
          entry.level < LEVEL.NONE ||
          entry.level > LEVEL.RED ||
          !finite(entry.at) ||
          entry.at > now + MINUTE ||
          now - entry.at > EVENT_MEMORY ||
          !(entry.since === null || (finite(entry.since) && entry.since <= entry.at))
        ) {
          continue;
        }
        this.levels.set(uid, { level: entry.level, at: entry.at, since: entry.since });
      }
    }
  }

  snapshot() {
    const levels = {};
    for (const [uid, entry] of this.levels) {
      levels[uid] = entry;
    }
    return {
      version: 1,
      pause: this.pause
        ? { kind: this.pause.kind, until: this.pause.until, count: this.pause.count }
        : null,
      refused: this.refused
        ? { salt: this.refused.salt, tag: this.refused.tag, status: this.refused.status }
        : null,
      attempt: this.kept,
      levels,
    };
  }

  /** Save, waited at most SAVE_WAIT; never over a /data that could not be read. */
  async save() {
    if (this.storeState !== 'ok') {
      return false;
    }
    let timer;
    try {
      return await Promise.race([
        this.store.save(this.snapshot()).then(() => true),
        new Promise((resolve) => {
          timer = this.timers.setTimeout(() => resolve(false), SAVE_WAIT);
        }),
      ]);
    } catch (err) {
      this.logger.warn(`/data not written: ${err?.message ?? err}`);
      return false;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  saveSoon() {
    this.save().catch(() => {});
  }

  // --- Pace ------------------------------------------------------------------

  interval() {
    return this.config.readInterval * 1000;
  }

  /** The wait after an attempt: the interval, doubled per failure up to BACKOFF_MAX. */
  waitAfter(failures) {
    const interval = this.interval();
    if (failures <= 0) {
      return interval;
    }
    return Math.max(interval, Math.min(BACKOFF_MAX, interval * 2 ** (failures - 1)));
  }

  /** The UIDs of the configuration whose device the user created. */
  createdUids() {
    const ids = new Set((this.gladys.devices ?? []).map((device) => device?.external_id));
    return this.config.uids.filter((uid) => ids.has(idsOf(this.gladys, uid).device));
  }

  pausedAt(mono) {
    return this.pause !== null && mono < this.pause.due;
  }

  /** The reason no automatic read may start now, else null. */
  blockedAt(mono) {
    if (!this.running || !this.linked) return 'stopped';
    if (this.storeState === 'pending') return 'store';
    if (this.config.tokenState !== 'ok') return 'token';
    if (this.refused) return 'refused';
    if (this.pausedAt(mono)) return 'paused';
    return null;
  }

  schedule() {
    if (this.tickTimer !== null) {
      this.timers.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    if (!this.running || this.reading) {
      return;
    }
    const mono = this.monotonic();
    const blocked = this.blockedAt(mono);
    let due;
    if (blocked === 'paused') {
      due = this.pause.due;
    } else if (blocked || this.createdUids().length === 0) {
      return;
    } else {
      due = this.nextDue;
    }
    this.tickTimer = this.timers.setTimeout(
      () => {
        this.tickTimer = null;
        return this.tick();
      },
      Math.max(0, due - mono),
    );
  }

  tick() {
    const mono = this.monotonic();
    if (
      this.blockedAt(mono) ||
      this.reading ||
      this.nextDue > mono ||
      this.createdUids().length === 0
    ) {
      this.schedule();
      return Promise.resolve();
    }
    return this.exclusive(() => this.read());
  }

  /** One request at a time for the token, whoever asks (the loop, the button). */
  exclusive(fn) {
    const job = this.chain.then(async () => {
      this.reading = true;
      try {
        return await fn();
      } finally {
        this.reading = false;
        this.schedule();
      }
    });
    this.chain = job.catch(() => {});
    return job;
  }

  // --- One read --------------------------------------------------------------

  /**
   * Read the statuses now. `force`: the test button, which may read with a
   * token refused before (never during a pause).
   * @returns {Promise<{ ok: true } | { ok: false, code: string, status?: number }>}
   */
  async read({ force = false } = {}) {
    const generation = this.generation;
    const mono = this.monotonic();
    const blocked = this.blockedAt(mono);
    if (blocked && !(force && blocked === 'refused')) {
      return { ok: false, code: blocked };
    }
    this.attemptMono = mono;
    this.nextDue = mono + this.waitAfter(this.failures);
    this.kept = { at: this.now(), failures: this.failures };
    // The attempt is in /data before the request: a restart never reads sooner.
    await this.save();
    if (generation !== this.generation) {
      return { ok: false, code: 'stale' };
    }
    const still = this.blockedAt(this.monotonic());
    if (still && !(force && still === 'refused')) {
      return { ok: false, code: still };
    }
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const cached = this.statuses;
      const answer = await fetchStatuses({
        token: this.config.token,
        version: this.version,
        fetchImpl: this.fetchImpl,
        signal: controller.signal,
        timeoutMs: this.requestTimeout,
        lastModified: cached ? this.lastModified : null,
      });
      if (generation !== this.generation) {
        return { ok: false, code: 'stale' };
      }
      if (!answer.notModified) {
        this.statuses = answer.statuses;
        this.lastModified = answer.lastModified;
      } else if (!cached) {
        throw new ApiError('unreadable', { status: 304 });
      }
      this.readingMono = this.monotonic();
      this.readingAt = this.now();
      this.failures = 0;
      this.lastError = null;
      this.nextDue = mono + this.interval();
      this.kept = { at: this.kept.at, failures: 0 };
      if (this.refused) {
        this.logger.info('The token was accepted: the refusal is lifted');
      }
      this.refused = null;
      this.pause = null;
      this.armStale();
      await this.publishLevels(true);
      this.saveSoon();
      return { ok: true };
    } catch (err) {
      if (generation !== this.generation) {
        return { ok: false, code: 'stale' };
      }
      return this.failed(err, mono);
    } finally {
      if (this.inflight === controller) {
        this.inflight = null;
      }
      if (generation === this.generation) {
        await this.reportStatus();
      }
    }
  }

  failed(err, mono) {
    const code = err instanceof ApiError ? err.code : 'unreadable';
    const status = err instanceof ApiError ? err.status : null;
    this.logger.warn(`alerts.in.ua: ${code}${status ? ` (HTTP ${status})` : ''}`);
    if (code === 'refused') {
      const salt = this.random(16).toString('hex');
      this.refused = {
        salt,
        tag: tagOf(salt, this.config.token),
        status,
        token: this.config.token,
      };
      this.saveSoon();
      return { ok: false, code, status };
    }
    if (code === 'rate_limited' || code === 'denied') {
      const kind = code === 'rate_limited' ? 'rate' : 'denied';
      const count = Math.min(32, (this.pause?.kind === kind ? this.pause.count : 0) + 1);
      const base = kind === 'rate' ? PAUSE_MIN : DENIED_PAUSE;
      const asked = kind === 'rate' ? err.retryAfter : null;
      const wait = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, asked ?? base * 2 ** (count - 1)));
      // From the instant of the decision, read once.
      const at = this.monotonic();
      this.pause = { kind, until: this.now() + wait, due: at + wait, count };
      this.saveSoon();
      return { ok: false, code, status };
    }
    this.failures = Math.min(20, this.failures + 1);
    this.lastError = code;
    this.nextDue = mono + this.waitAfter(this.failures);
    this.kept = { at: this.kept?.at ?? this.now(), failures: this.failures };
    this.saveSoon();
    return { ok: false, code, status };
  }

  // --- Publication -----------------------------------------------------------

  /** The status says "not recent" STALE_AFTER after the last good read. */
  armStale() {
    if (this.staleTimer !== null) {
      this.timers.clearTimeout(this.staleTimer);
    }
    this.staleTimer = this.timers.setTimeout(() => {
      this.staleTimer = null;
      this.reportStatus();
    }, STALE_AFTER + 1);
  }

  isFresh(mono) {
    return this.readingMono !== null && mono - this.readingMono <= this.interval();
  }

  /**
   * Publish the level of each created location and, after a read
   * (`fromRead`), fire the scene events of the changes. Without a fresh read,
   * nothing is published (never an old level republished as new).
   */
  async publishLevels(fromRead = false) {
    if (!this.statuses || !this.linked) {
      return;
    }
    const now = this.now();
    const states = [];
    const changes = [];
    for (const uid of this.createdUids()) {
      const level = levelOf(this.statuses, uid);
      if (level === undefined) {
        continue;
      }
      states.push(levelState(this.gladys, uid, level));
      if (!fromRead) {
        continue;
      }
      const previous = this.levels.get(uid);
      const known = previous && now - previous.at <= EVENT_MEMORY ? previous : null;
      let since = null;
      if (isAlert(level)) {
        since = known && isAlert(known.level) ? known.since : known ? now : null;
      }
      this.levels.set(uid, { level, at: now, since });
      if (known) {
        changes.push({ uid, before: known, level, now });
      }
    }
    if (states.length > 0) {
      try {
        await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT });
      } catch (err) {
        this.logger.warn(`States not published: ${err?.message ?? err}`);
      }
    }
    for (const change of changes) {
      await this.fireEvents(change);
    }
  }

  /** The changes of one location: started (or escalated to red), ended. */
  async fireEvents({ uid, before, level, now }) {
    const common = {
      location: idsOf(this.gladys, uid).device,
      uid,
      location_name: locationName(uid),
      // The previous level is older than two intervals: a restart, an outage.
      late: now - before.at > 2 * this.interval() + MINUTE,
    };
    if (isAlert(level) && (!isAlert(before.level) || level > before.level)) {
      await this.sendEvent(SCENE_TRIGGERS.started, {
        ...common,
        level: LEVEL_NAMES[level],
        escalated: isAlert(before.level),
      });
    } else if (!isAlert(level) && isAlert(before.level)) {
      await this.sendEvent(SCENE_TRIGGERS.ended, {
        ...common,
        duration_minutes:
          before.since === null ? null : Math.max(0, Math.round((now - before.since) / MINUTE)),
      });
    }
  }

  async sendEvent(key, data) {
    const mono = this.monotonic();
    this.events = this.events.filter((at) => mono - at < MINUTE);
    if (this.events.length >= MAX_EVENTS_PER_MINUTE) {
      this.logger.warn(`Scene event ${key} dropped: too many this minute`);
      return;
    }
    this.events.push(mono);
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      this.logger.warn(`Scene event ${key} not sent: ${err?.message ?? err}`);
    }
  }

  /** The levels of a fresh read only (connected, device created, configuration saved). */
  async publishFresh() {
    if (this.isFresh(this.monotonic())) {
      await this.publishLevels(false);
    }
  }

  /** The devices of the configuration, in the Discover tab. */
  async publishDevices() {
    const devices = this.config.uids.map((uid) => buildDevice(this.gladys, uid));
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Devices not published: ${err?.message ?? err}`);
    }
  }

  /** A device was created, updated or deleted: publish what is fresh, read when due. */
  async onDeviceChanged() {
    await this.publishFresh();
    this.schedule();
    await this.reportStatus();
  }

  // --- Status ----------------------------------------------------------------

  statusNow() {
    const mono = this.monotonic();
    const now = this.now();
    const wallOf = (due) => now + Math.max(0, due - mono);
    const notes = [];
    if (this.config.invalidLocations.length > 0) {
      notes.push(STATUS.invalidLocations(this.config.invalidLocations));
    }
    if (this.config.droppedLocations > 0) {
      notes.push(STATUS.droppedLocations(this.config.droppedLocations, MAX_LOCATIONS));
    }
    if (this.storeState === 'pending') return [false, STATUS.store];
    if (this.config.tokenState === 'missing') return [false, STATUS.tokenMissing];
    if (this.config.tokenState === 'invalid') return [false, STATUS.tokenInvalid];
    if (this.config.uids.length === 0) return [false, join([STATUS.noLocation, ...notes])];
    if (this.refused) return [false, STATUS.refused(this.refused.status)];
    if (this.pausedAt(mono)) {
      const until = wallOf(this.pause.due);
      return [false, this.pause.kind === 'rate' ? STATUS.paused(until) : STATUS.denied(until)];
    }
    const created = this.createdUids();
    if (created.length === 0) return [true, join([STATUS.noDevice, ...notes])];
    const stale =
      this.readingMono === null || mono - this.readingMono > STALE_AFTER
        ? STATUS.stale(this.readingAt)
        : null;
    if (this.failures > 0) {
      return [
        false,
        join([STATUS.failing(this.lastError, wallOf(this.nextDue)), ...(stale ? [stale] : [])]),
      ];
    }
    if (!this.statuses) return [true, STATUS.waiting];
    if (stale) return [false, stale];
    const unknown = this.config.uids.filter((uid) => levelOf(this.statuses, uid) === undefined);
    if (unknown.length > 0) notes.unshift(STATUS.unknownUids(unknown.slice(0, 5)));
    const alerts = created.filter((uid) => isAlert(levelOf(this.statuses, uid) ?? 0)).length;
    return [true, join([STATUS.ok(created.length, alerts), ...notes])];
  }

  /** One setConnectionStatus per state. */
  async reportStatus() {
    if (!this.running || !this.linked) {
      return;
    }
    const [connected, message] = this.statusNow();
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.lastStatus = null;
      this.logger.warn(`Status not set: ${err?.message ?? err}`);
    }
  }

  // --- Buttons ---------------------------------------------------------------

  levelLines() {
    const en = [];
    const fr = [];
    for (const uid of this.config.uids) {
      const level = levelOf(this.statuses, uid);
      const line =
        level === undefined
          ? TEST.unknown(locationName(uid), uid)
          : TEST.line(locationName(uid), uid, level);
      en.push(line.en);
      fr.push(line.fr);
    }
    if (en.length === 0) {
      return TEST.none;
    }
    return { en: en.join('\n'), fr: fr.join('\n') };
  }

  /**
   * "Test the connection": one request, never sooner than TEST_SPACING after
   * the last one (the last answer is shown instead), never during a pause;
   * it may try a token refused before.
   */
  async testConnection() {
    if (this.config.tokenState === 'missing') return STATUS.tokenMissing;
    if (this.config.tokenState === 'invalid') return STATUS.tokenInvalid;
    if (this.storeState === 'pending') return STATUS.store;
    const mono = this.monotonic();
    if (this.pausedAt(mono)) {
      const until = this.now() + (this.pause.due - mono);
      return this.pause.kind === 'rate' ? STATUS.paused(until) : STATUS.denied(until);
    }
    if (this.attemptMono !== null && mono - this.attemptMono < TEST_SPACING) {
      if (this.refused) return STATUS.refused(this.refused.status);
      if (this.failures > 0 || !this.statuses) {
        return STATUS.failing(this.lastError ?? 'pending', this.now() + TEST_SPACING);
      }
      const seconds = Math.max(0, Math.round((mono - this.readingMono) / 1000));
      return TEST.recent(seconds, this.levelLines());
    }
    const result = await this.exclusive(() => this.read({ force: true }));
    if (result.ok) {
      return TEST.ok(this.levelLines());
    }
    if (result.code === 'refused') return STATUS.refused(result.status);
    if (result.code === 'paused') return this.statusNow()[1];
    if (this.pause && (result.code === 'rate_limited' || result.code === 'denied')) {
      return this.pause.kind === 'rate'
        ? STATUS.paused(this.pause.until)
        : STATUS.denied(this.pause.until);
    }
    return STATUS.failing(result.code, this.now() + Math.max(0, this.nextDue - this.monotonic()));
  }

  /** "Find a location": the UIDs whose name holds the words typed. No request. */
  findLocation(fields = {}) {
    const query = String(fields.query ?? '').slice(0, 100);
    if (query.trim().length < 2) {
      return SEARCH.short;
    }
    const found = searchLocations(query);
    if (found.length === 0) {
      return SEARCH.none;
    }
    return SEARCH.found(found.map((f) => `${f.uid}: ${f.name}`));
  }
}
