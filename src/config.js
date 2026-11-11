// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The token is checked, never shown: it only travels in the Authorization
// header of the requests to api.alerts.in.ua.
// -----------------------------------------------------------------------------

import { MAX_LOCATIONS, MAX_TOKEN_LENGTH, MAX_UID, READ_INTERVAL } from './constants.js';

/** Defaults: they MUST match the `default` values of the manifest. */
export const DEFAULT_CONFIG = {
  read_interval: READ_INTERVAL.default,
};

/** A token: printable ASCII, no space nor control character, bounded. */
const TOKEN = /^[\x21-\x7e]+$/;

/** 'missing' | 'invalid' | 'ok' */
export function tokenState(token) {
  if (!token) {
    return 'missing';
  }
  return token.length <= MAX_TOKEN_LENGTH && TOKEN.test(token) ? 'ok' : 'invalid';
}

const integer = (value, { min, max, default: fallback }) => {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * The UIDs typed by the user: integers separated by commas, semicolons,
 * spaces or lines. What is not a UID is only counted (never shown: it may be a
 * secret pasted in the wrong field), duplicates are dropped, MAX_LOCATIONS at most.
 */
export function parseLocations(value) {
  const uids = [];
  let invalid = 0;
  let dropped = 0;
  for (const entry of String(value ?? '').split(/[\s,;]+/)) {
    if (!entry) {
      continue;
    }
    const uid = /^\d{1,4}$/.test(entry) ? Number(entry) : Number.NaN;
    if (!Number.isInteger(uid) || uid < 1 || uid > MAX_UID) {
      // Counted, never quoted: a token pasted here by mistake must not reach the status.
      invalid += 1;
      continue;
    }
    if (uids.includes(uid)) {
      continue;
    }
    if (uids.length >= MAX_LOCATIONS) {
      dropped += 1;
      continue;
    }
    uids.push(uid);
  }
  return { uids, invalid, dropped };
}

export function normalizeConfig(raw = {}) {
  const token = typeof raw?.api_token === 'string' ? raw.api_token.trim() : '';
  const { uids, invalid, dropped } = parseLocations(raw?.locations);
  return {
    token,
    tokenState: tokenState(token),
    uids,
    invalidLocations: invalid,
    droppedLocations: dropped,
    readInterval: integer(raw?.read_interval, READ_INTERVAL),
  };
}
