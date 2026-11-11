// -----------------------------------------------------------------------------
// The numbers of the integration, in one place (the tests and the manifest
// test read them from here).
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/**
 * The official API of alerts.in.ua (https://devs.alerts.in.ua). One request
 * per read: the air raid status of every location of Ukraine, one character
 * per location UID, with the red / yellow level (v2). Never
 * api.ukrainealarm.com (it answers with an anti-bot challenge).
 */
export const API_URL = 'https://api.alerts.in.ua/v2/iot/active_air_raid_alerts.json';
/** The only host the token is ever sent to. */
export const API_HOST = 'api.alerts.in.ua';

/**
 * One read per interval (seconds). The API allows 8 to 10 requests a minute
 * per IP address (12 is the hard limit, then 429 and a ban): 20 s at the
 * fastest leaves room for another application behind the same address.
 */
export const READ_INTERVAL = { min: 20, max: 600, default: 30 };
/** Locations watched at most (one request reads them all). */
export const MAX_LOCATIONS = 20;
/** The highest UID accepted (the string held 1805 characters in 2026-10). */
export const MAX_UID = 9999;

/** A request never lasts longer than this, the body read included. */
export const REQUEST_TIMEOUT = 10 * SECOND;
/** A larger answer is cut and not read (the string is under 2 KB). */
export const MAX_BODY_BYTES = 64 * 1024;
/** A token longer than this is not one (the API gives ~40 characters). */
export const MAX_TOKEN_LENGTH = 256;

/** A 429 pauses every read (Retry-After, else 1 min doubling): never shorter, never longer. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** A 403 (address blocked, country not served): 30 min doubling, up to PAUSE_MAX. */
export const DENIED_PAUSE = 30 * MINUTE;
/** A failing read (5xx, timeout, network, unreadable answer) is retried later and later, up to this. */
export const BACKOFF_MAX = 15 * MINUTE;

/** The test button never sends a request sooner than this after the last one. */
export const TEST_SPACING = READ_INTERVAL.min * SECOND;

/** /data: read again on this timer while unreadable; a save waited at most this long. */
export const STORE_RETRY = 10 * SECOND;
export const SAVE_WAIT = 2 * SECOND;
/** After this many failed loads, the reads go on without /data (nothing overwritten). */
export const STORE_LOADS_BEFORE_MEMORY = 3;

/** `connected` reads the configuration again on failure, later and later, up to this. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;

/** No good read for this long: the status says the data is not recent. */
export const STALE_AFTER = 10 * MINUTE;
/**
 * A level kept in /data older than this is not compared with the first read
 * after a restart: no scene event for a change that may be hours old.
 */
export const EVENT_MEMORY = 2 * HOUR;
/** Scene events: at most this many a minute (the core admits 300 for the integration). */
export const MAX_EVENTS_PER_MINUTE = 60;

/** The time zone of the times shown in the statuses. */
export const TIME_ZONE = 'Europe/Kyiv';

/**
 * The level of a location, the `level` feature (keys forever):
 *   0 no alert, 1 alert in part of the location (some of its raions or
 *   hromadas), 2 alert of yellow level, 3 alert of red level.
 */
export const LEVEL = { NONE: 0, PARTIAL: 1, YELLOW: 2, RED: 3 };
/** The names of the alert levels in the scene events (keys forever). */
export const LEVEL_NAMES = { [LEVEL.YELLOW]: 'yellow', [LEVEL.RED]: 'red' };
