# True Crew campaign summary API

`GET /api/internal/campaign-summary` is a True Crew internal, read-only campaign measurement boundary layered onto the self-hosted Umami deployment.

## Required server configuration

- `TRUECREW_ANALYTICS_READ_TOKEN`: high-entropy bearer token shared only with approved internal readers.
- `TRUECREW_ANALYTICS_WEBSITE_ID`: immutable Umami website UUID for the production True Crew site.
- `TRUECREW_ANALYTICS_SITE_HOSTNAME`: exact hostname accepted for production events; currently `www.truecrewllc.com`.

The endpoint returns `503` when website scope is missing or invalid. It also returns `503` when `CLICKHOUSE_URL` is configured because this implementation is deliberately PostgreSQL-only; it must never silently query a stale backend.

## Measurement semantics

- Select the first campaign-bearing touch for each session before matching the requested campaign, with the scan bounded to the session-salt period containing the requested start.
- Include attributed events only from that first touch forward and only inside the requested end boundary.
- Count page views with `event_type = 1` and custom events with `event_type = 2`.
- Scope both campaign touches and attributed events to the configured website UUID and hostname.
- Accept explicit RFC 3339 windows only, with a maximum duration of 31 days.

## Privacy and resource bounds

The response contains aggregate metrics only. Source and medium are normalized to governed categories, free-form UTM content is not returned, path values are normalized and bucketed to known route classes, low-cardinality dimension groups are suppressed, and every returned breakdown has a fixed top-N limit. Raw session identifiers, visitor identifiers, contact data, free-form UTM values, and raw paths are not returned.

Responses require the bearer token and use `Cache-Control: private, no-store`.
