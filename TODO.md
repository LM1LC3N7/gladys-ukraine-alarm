# TODO

## Decisions

- 2026-11-11: **alerts.in.ua official API only**, with the token of each user (free, on request).
  `api.ukrainealarm.com` (the source of Home Assistant) answers with a Cloudflare challenge from the VM: never
  used (anti-bot). Written from the official documentation (devs.alerts.in.ua); the official Python client
  alerts-in-ua-py (MIT) only gave the names of the raions (THIRD_PARTY_NOTICES.md). No code copied.
- 2026-11-11: **one endpoint**, `/v2/iot/active_air_raid_alerts.json` (every UID in one string, R/Y levels):
  one request per interval whatever the number of locations. Interval 30 s by default, 20 s minimum, 600 s
  maximum (API: 8-10 requests a minute per IP soft, 12 hard, then ban).
- 2026-11-11: feature `risk`/`integer` 0..3 (none, partial, yellow, red); no binary feature. An `A` (active
  without level) counts as red. A space (no data) publishes nothing and is named in the status.
- 2026-11-11: scene triggers fire on yellow/red of the whole location only (level >= 2), escalation yellow to
  red fires "started" again with `escalated`; partial (1) fires nothing. Levels kept 2 h in /data for the
  events after a restart (`late`).
- 2026-11-11: 401 = refused token; 403 = address blocked / country not served (documented by the API), a pause
  (30 min doubling to 6 h), never a refusal; 5xx, timeout, cut or unreadable body: backoff up to 15 min.
- 2026-11-11: no redirect followed (the token stays on api.alerts.in.ua); the URL host is checked before sending.
- 2026-11-11: version 0.1.0 by hand (package.json, lock, manifest, `docker_image`).
- 2026-11-11: categories `security` and `environment` (as gladys-nina); no `keywords` nor `countries` in the
  manifest (store rule): the country is UA.
- 2026-11-11: `poll_frequency` not used: the integration paces itself. No widget nor scene action in v1.
- 2026-11-11: `.github/workflows/ci.yml` gets `timeout-minutes` on its jobs (lot rule): the release tag is set
  by hand.

## Next

- Check the answers with a real token: the v2 string, `Last-Modified` / 304, the body of the errors, and
  whether a hromada shows an alert declared for its whole oblast.
- The other threats (`/v1/alerts/active.json`: artillery, urban fights, chemical, nuclear) and the threat
  details (drones, missiles...), at most one more request per interval.
- English names of the raions; names of the hromadas.
- A dashboard widget.
