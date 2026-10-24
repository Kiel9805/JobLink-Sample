# JobLink

Upload a resume, and JobLink finds companies near you in the Philippines that fit it, on a map with one-click directions (drive, motorcycle, commute, walk).

Resume → Gemini (job titles, skills, search queries) → Google Places → map markers → Google Maps directions.

## Setup

1. Install Node 22.9+ (24 recommended).
2. `npm install`
3. Copy `.env.example` to `.env` and fill in the keys. **[docs/setup-keys.md](docs/setup-keys.md)** explains how to get each one.
   `DATABASE_URL` is optional: without it the app works but doesn't cache Places results.

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

- `server/index.js`: Express routes (`GET /api/config`, `POST /api/search`) and static files
- `server/gemini.js`: resume PDF → profile JSON
- `server/places.js`: Places Text Search with a 30-day Postgres cache
- `public/`: the page (plain HTML/JS/CSS, no build step)
- `docs/master-prompt.md`: the build spec; `.claude/agents/`: the sub-agents that built it

## Privacy

Resumes are sent to Gemini and never stored or logged. Use Gemini's **paid tier** for real users: on the free tier, Google may use inputs to improve its products. Resumes are personal data under the PH Data Privacy Act (RA 10173).

## Known limits (before a public launch)

- **No rate limiting.** Every search costs Gemini and Places calls, so add per-IP limits before going public.
- **Places cost:** `rating` and `websiteUri` put Text Search in Google's Enterprise pricing tier. Drop them to cut cost.
- Old cache rows (over 30 days) are ignored but never deleted.
- Uses `google.maps.Marker`, which still works but is deprecated. Switching to `AdvancedMarkerElement` needs a Map ID.
- Lists companies *near* you, not live job openings. For PH job listings, add Jooble or Careerjet later.
