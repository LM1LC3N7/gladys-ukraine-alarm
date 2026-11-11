# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- Ukrainian air raid alerts from the official API of alerts.in.ua (v2 IoT
  statuses, red and yellow levels), with the user's own token: one device per
  location UID (oblast, raion, hromada or city) with its alert level (0 to 3).
- Scene triggers "Air raid alert started" (yellow or red, or yellow turned red)
  and "Air raid alert ended" (with its duration), compared across a restart
  within 2 hours ("seen late").
- One request per interval for every location (30 s by default, 20 s to 600 s),
  `If-Modified-Since`, one request in flight, the attempt written to /data
  before the request.
- 429 pause (Retry-After against the Date header, 1 min to 6 h), 403 pause
  (30 min doubling to 6 h), backoff of the failures up to 15 min, all kept in
  /data; a refused token (401) stops the reads until a new token or a
  successful test (8 bits of a salted hash in /data, never the token).
- Buttons "Test the connection" (never sooner than 20 s after the last request)
  and "Find a location" (UID of an oblast, raion or city by name, Ukrainian or
  Latin letters, no request).
- English and French guides.
