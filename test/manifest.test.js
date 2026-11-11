// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. The version is
// never pinned: only its form and its agreement everywhere.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LEVEL_NAMES, MAX_LOCATIONS, READ_INTERVAL } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { ACTIONS, SCENE_TRIGGERS } from '../src/handlers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics; the same semver version in the four places', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-ukraine-alarm:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-ukraine-alarm');
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-ukraine-alarm/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['security', 'environment']);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.countries, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.match(pkg.dependencies['@gladysassistant/integration-sdk'], /^\^\d+\.\d+\.\d+$/);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(
      docs,
      /not\s+affiliated\s+with\s+alerts\.in\.ua|sans\s+lien\s+avec\s+alerts\.in\.ua/i,
    );
    assert.match(docs, /never\s+tested\s+with\s+a\s+real|jamais\s+testé\s+avec\s+une?\s+vra/i);
    assert.match(docs, /NOT a safety system|PAS un système de sécurité/);
  }
  assert.match(fields.intro.description.en, /Never tested with a real token/);
  assert.match(fields.intro.description.fr, /Jamais testé avec un vrai jeton/);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
});

test('the token: a secret, no default, described as kept by Gladys; no key prefixed gladys_', () => {
  assert.equal(fields.api_token.type, 'secret');
  assert.equal(fields.api_token.default, undefined);
  assert.equal(fields.api_token.placeholder, undefined);
  assert.match(
    fields.api_token.description.en,
    /Kept by Gladys in its database, never shown again, sent only to alerts\.in\.ua/,
  );
  assert.match(
    fields.api_token.description.fr,
    /Gardé par Gladys dans sa base, jamais réaffiché, envoyé seulement à alerts\.in\.ua/,
  );
  for (const field of manifest.config_schema) {
    assert.ok(!field.key.startsWith('gladys_'), field.key);
    if (field.type === 'secret') assert.equal(field.default, undefined, field.key);
  }
  assert.equal(manifest.containers, undefined);
  assert.equal(manifest.location, undefined);
});

test('the configuration matches the code', () => {
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  assert.deepEqual(
    [fields.read_interval.min, fields.read_interval.max, fields.read_interval.default],
    [READ_INTERVAL.min, READ_INTERVAL.max, READ_INTERVAL.default],
  );
  assert.match(fields.locations.description.en, new RegExp(`${MAX_LOCATIONS} at most`));
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the actions and scene triggers are the ones the code handles', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((a) => a.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 30 && action.timeout_seconds <= 120, action.key);
  }
  const started = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.started);
  assert.deepEqual(
    started.fields.find((f) => f.key === 'level').options.map((o) => o.value),
    Object.values(LEVEL_NAMES),
  );
  // The variables and the fields are the keys the code sends (src/app.js fireEvents).
  const app = read('src/app.js');
  for (const trigger of manifest.scene_triggers) {
    assert.ok(
      trigger.fields.every((f) => f.type !== 'boolean'),
      trigger.key,
    );
    for (const entry of [...trigger.variables, ...trigger.fields]) {
      assert.match(app, new RegExp(`\\b${entry.key}[:,]`), `${trigger.key}.${entry.key}`);
    }
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('published devices: read-only risk level, no switch nor binary, supported_options none; core rules', () => {
  const gladys = createFakeGladys({ selector: 'ukraine-alarm' });
  const require = createRequire(import.meta.url);
  const core = '/home/claude/code/Gladys/server/utils/constants.js';
  const constants = existsSync(core) ? require(core) : null;
  for (const uid of [31, 14, 1293, 1700]) {
    const device = buildDevice(gladys, uid);
    assert.equal(device.external_id, `ext:ukraine-alarm:location:${uid}`);
    assert.ok(device.name.length <= 100);
    for (const feature of device.features) {
      assert.equal(feature.read_only, true, feature.external_id);
      assert.equal(feature.supported_options, undefined, feature.external_id);
      assert.equal(feature.category, 'risk');
      assert.equal(feature.type, 'integer');
      assert.equal(typeof feature.name, 'string');
      assert.deepEqual([feature.min, feature.max], [0, 3]);
      assert.equal(feature.unit, undefined);
      if (constants) {
        assert.ok(Object.values(constants.DEVICE_FEATURE_CATEGORIES).includes(feature.category));
        assert.ok(Object.values(constants.DEVICE_FEATURE_TYPES.RISK).includes(feature.type));
      }
    }
  }
});
