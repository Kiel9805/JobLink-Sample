# JobLink

Upload a resume, and JobLink finds job openings and companies near you in the Philippines that fit it, on a map with one-click directions (drive, motorcycle, commute, walk).

Resume → Gemini (job titles, skills, workplace categories) → Jooble (openings for the top title) + OpenStreetMap search (Nominatim) → list + map markers → Google Maps directions.

## Setup

1. Install Node 22.9+ (24 recommended).
2. `npm install`
3. Copy `.env.example` to `.env` and add your Gemini key (and optionally a Jooble key for job openings). See **[docs/setup-keys.md](docs/setup-keys.md)**.
   `DATABASE_URL` is optional: without it the app works but doesn't cache search results.

## Run

```bash
npm start
```

Open http://localhost:3000. The table the cache needs is created on startup.

## Test

```bash
npm test
```

External APIs are mocked. The Postgres test runs only when `DATABASE_URL` is set.

## Layout

- `server/index.js`: Express route `POST /api/search` and static files
- `server/gemini.js`: resume PDF → profile JSON with OSM categories
- `server/places.js`: category allowlist + Nominatim search with a 30-day Postgres cache
- `server/jobs.js`: Jooble openings for the top job title in the nearest city
- `public/`: the page (plain HTML/JS/CSS + Leaflet, no build step)
- `docs/master-prompt.md`: the build spec; `.claude/agents/`: the sub-agents that built it

## Privacy

Resumes are sent to Gemini and never stored or logged. Use Gemini's **paid tier** for real users: on the free tier, Google may use inputs to improve its products. Resumes are personal data under the PH Data Privacy Act (RA 10173).

## Known limits (before a public launch)

- **Rate limit:** 10 searches per IP per hour, kept in memory (resets on restart, not shared across instances). When hosted behind a proxy, set `TRUST_PROXY=1`.
- **Free OSM services are for light use.** Nominatim allows 1 request/second (the server enforces this, so each search takes a few seconds and searches queue under load). The public map tiles are also for light use. For real traffic, switch to a hosted provider (e.g. LocationIQ, Geoapify, MapTiler) or self-host.
- **OSM coverage varies.** Many PH businesses are missing or untagged, and there are no ratings.
- Old cache rows (over 30 days) are ignored but never deleted.
- Job openings come from Jooble for the **top job title only**, in the nearest city. They have no map coordinates, so they appear in the list, not as markers. They aren't cached.

Map data © OpenStreetMap contributors (ODbL).
