# Third-party notices

## alerts-in-ua-py (MIT)

The names of the raions and of the cities with their own alerts in
`src/locations.js` (UID -> Ukrainian name) are taken from the location table of
the official Python client of alerts.in.ua,
[alerts-in-ua-py](https://github.com/alerts-ua/alerts-in-ua-py) (commit
14b37ca, 2026-10-13). No code of it is copied: the integration is written from
the official API documentation (https://devs.alerts.in.ua). Its license:

```
MIT License

Copyright (c) 2023 Ukrzen Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## alerts.in.ua

The alerts are read from the official API of alerts.in.ua (https://alerts.in.ua),
a volunteer project, with the token each user requests for themselves. The
integration is not affiliated with alerts.in.ua. Their terms apply: the data is
provided as is, with possible delays, and must not be used for critical
infrastructure. The names and UIDs of the oblasts come from the "Location UID"
section of the API documentation.
