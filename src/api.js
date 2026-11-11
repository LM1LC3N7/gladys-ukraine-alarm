// -----------------------------------------------------------------------------
// The only place that talks to alerts.in.ua: one GET of the v2 IoT status of
// every location, the token in the Authorization header (never in the URL),
// the User-Agent of the integration, If-Modified-Since when a previous answer
// is known (the API answers 304 when nothing changed). Bounded in time (the
// body included) and in size; no redirect followed (the token stays on
// api.alerts.in.ua).
//
// What an answer means:
//   200 + a JSON string of N/P/Y/R/A/space  the statuses
//   304                                     unchanged since the last answer
//   401                                     the token is refused ('refused')
//   403                                     address blocked or country not served ('denied')
//   429                                     too many requests ('rate_limited', Retry-After)
//   anything else, a cut or unreadable body a failure, never a refusal
// -----------------------------------------------------------------------------

import { API_HOST, API_URL, LEVEL, MAX_BODY_BYTES, MAX_UID } from './constants.js';

export class ApiError extends Error {
  /** `code`: refused | denied | rate_limited | server | http | timeout | network | too_large | unreadable */
  constructor(code, { status = null, retryAfter = null } = {}) {
    super(status ? `${code} (HTTP ${status})` : code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** The User-Agent of the integration: who calls, never the token. */
export const userAgent = (version) =>
  `gladys-ukraine-alarm/${version} (+https://github.com/LM1LC3N7/gladys-ukraine-alarm)`;

const STATUS_STRING = /^[NAPRY ]+$/;

/**
 * The wait a 429 asks for, in ms: Retry-After in seconds, or as a date
 * compared with the Date header of the same answer (never with the local
 * clock). Unreadable: null (the caller's own backoff applies).
 */
export function retryAfterMs(headers) {
  const value = headers.get('retry-after')?.trim();
  if (!value) {
    return null;
  }
  if (/^\d{1,7}$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  const date = Date.parse(headers.get('date') ?? '');
  if (!Number.isFinite(at) || !Number.isFinite(date)) {
    return null;
  }
  return Math.max(0, at - date);
}

/**
 * Read a body, cut beyond MAX_BODY_BYTES (the stream cancelled, never read to
 * its end) and stopped by `signal`: the timeout of the request covers the
 * body, whatever the fetch implementation does with the signal.
 */
async function readBounded(response, signal) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new ApiError('too_large', { status: response.status });
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const stop = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        stop();
        throw new ApiError('timeout');
      }
      const { done, value } = await reader.read();
      if (signal.aborted) {
        throw new ApiError('timeout');
      }
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        stop();
        throw new ApiError('too_large', { status: response.status });
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The status string of a body, else an 'unreadable' error. */
export function parseStatuses(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError('unreadable');
  }
  if (typeof value !== 'string' || value.length > MAX_UID + 1 || !STATUS_STRING.test(value)) {
    throw new ApiError('unreadable');
  }
  return value;
}

/**
 * The level of a UID in a status string (src/constants.js LEVEL), or
 * undefined when the API has no data for it (a space, or beyond the end).
 * A (an alert of v1, level not given) counts as red: never weaker than it may be.
 */
export function levelOf(statuses, uid) {
  switch (statuses?.[uid]) {
    case 'N':
      return LEVEL.NONE;
    case 'P':
      return LEVEL.PARTIAL;
    case 'Y':
      return LEVEL.YELLOW;
    case 'R':
    case 'A':
      return LEVEL.RED;
    default:
      return undefined;
  }
}

/**
 * GET the statuses. Resolves `{ notModified: true }` on a 304, else
 * `{ statuses, lastModified }`; throws an ApiError.
 */
export async function fetchStatuses({
  token,
  version,
  fetchImpl,
  signal,
  timeoutMs,
  lastModified = null,
  url = API_URL,
}) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.host !== API_HOST ||
    target.username !== '' ||
    target.password !== ''
  ) {
    throw new ApiError('http');
  }
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'User-Agent': userAgent(version),
  };
  if (lastModified) {
    headers['If-Modified-Since'] = lastModified;
  }
  // A timer of our own (AbortSignal.timeout is unref'd: it does not hold the
  // process, and a test runner may end before it fires).
  const deadline = new AbortController();
  const timeout = deadline.signal;
  const timer = setTimeout(() => deadline.abort(), Math.max(1, timeoutMs));
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    // Raced with the signal: an implementation that ignores it never holds the read.
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new ApiError('timeout'));
      combined.addEventListener('abort', onAbort, { once: true });
    });
    let response;
    try {
      response = await Promise.race([
        fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal: combined }),
        aborted,
      ]);
    } finally {
      combined.removeEventListener('abort', onAbort);
    }
    const status = response.status;
    if (status === 304) {
      await response.body?.cancel().catch(() => {});
      return { notModified: true };
    }
    if (status !== 200) {
      await response.body?.cancel().catch(() => {});
      if (status === 401) throw new ApiError('refused', { status });
      if (status === 403) throw new ApiError('denied', { status });
      if (status === 429) {
        throw new ApiError('rate_limited', { status, retryAfter: retryAfterMs(response.headers) });
      }
      throw new ApiError(status >= 500 ? 'server' : 'http', { status });
    }
    const statuses = parseStatuses(await readBounded(response, combined));
    const modified = response.headers.get('last-modified');
    return {
      notModified: false,
      statuses,
      // Sent back as is: a header value without CR, LF nor control character only.
      lastModified: modified && /^[\x20-\x7e]{1,64}$/.test(modified) ? modified : null,
    };
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (timeout.aborted) {
      throw new ApiError('timeout');
    }
    throw new ApiError(signal?.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}
