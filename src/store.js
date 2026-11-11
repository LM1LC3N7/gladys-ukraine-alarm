// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// pause after a 429 or a 403, the refused token (8 bits of a salted hash,
// never the token), the time of the last attempt and the failures (a
// restart never reads sooner than the interval), and the last level of each
// location (scene events after a restart). A small JSON file, written through
// a temporary file and a rename, one save after the other.
//
// `load()` tells three cases apart: the file is missing (an empty state),
// read (its content), or unreadable (it throws: the caller never takes it for
// an empty state, and never writes over it). Taken from gladys-iskra.
// -----------------------------------------------------------------------------

import { readFile, rename, stat, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/ukraine-alarm-state.json';
/** A larger file is not ours: unreadable. */
export const MAX_STATE_BYTES = 256 * 1024;

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

export function createFileStore(file = DEFAULT_STATE_FILE) {
  let queue = Promise.resolve();
  const write = async (data) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, file);
  };
  return {
    async load() {
      let info;
      try {
        info = await stat(file);
      } catch (err) {
        if (err?.code === 'ENOENT') {
          return {};
        }
        throw new StoreError(`stat: ${err?.code ?? 'error'}`);
      }
      if (info.size > MAX_STATE_BYTES) {
        throw new StoreError('too large');
      }
      let data;
      try {
        data = JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        throw new StoreError(`read: ${err?.code ?? 'not JSON'}`);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new StoreError('not an object');
      }
      return data;
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests): `fail` makes the next loads or saves throw. */
export function createMemoryStore(initial) {
  let data = initial === undefined ? undefined : structuredClone(initial);
  const store = {
    failLoad: 0,
    failSave: false,
    saves: 0,
    async load() {
      if (store.failLoad > 0) {
        store.failLoad -= 1;
        throw new StoreError('unreadable (test)');
      }
      return data === undefined ? {} : structuredClone(data);
    },
    async save(next) {
      store.saves += 1;
      if (store.failSave) {
        throw new StoreError('unwritable (test)');
      }
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
  return store;
}
