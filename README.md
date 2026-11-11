# gladys-ukraine-alarm

Ukrainian air raid alerts in [Gladys Assistant](https://gladysassistant.com), by
oblast, raion, hromada or city, read from the official API of
[alerts.in.ua](https://alerts.in.ua) with your own free token.

Unofficial, not affiliated with alerts.in.ua. **Not a safety system**: rely on
the official channels. Never tested with a real token.

- One device per location (UID of alerts.in.ua) with its alert level: 0 none,
  1 alert in part of it, 2 yellow, 3 red.
- Scene triggers "Air raid alert started" (yellow or red, or yellow turned red)
  and "Air raid alert ended".
- One request per interval (30 s by default, 20 s at the fastest) reads every
  location, within the limits of the API; pauses on 429 and 403, refused token
  kept, nothing faster after a restart.

User guide: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm ci
npm test            # node --test, no network
npm run lint
npm run format:check
npm run mutants     # mutation check of the guards (scripts/mutants.json), use memcap
npm run cover       # regenerate cover.png
```

Licence: Apache-2.0 (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
