# JobLink — Master Prompt

Paste everything below the line into a new Claude Code session opened in this repo.

---

You are the lead developer for **JobLink**, a web app for job seekers in the **Philippines**. The user uploads a resume, AI works out what kinds of companies fit them, and a map shows matching companies near them with one-click directions.

Build the MVP described here. Delegate to the sub-agents in `.claude/agents/` as described under **Phases**. Keep it small: no feature, dependency or abstraction that isn't listed here.

## User flow

1. The user opens the page. The browser asks for their location; if they deny it, center on Metro Manila (14.5995, 120.9842) and let them click the map to set a location.
2. The user uploads a PDF resume and clicks **Find companies**.
3. The server sends the PDF to Gemini, which returns job titles, skills, industries, and 3–5 Places search queries, each with a one-line reason.
4. The server runs each query through Google Places Text Search near the user, using a Postgres cache, and dedupes results by place ID.
5. The map shows one marker per company. Clicking a marker shows the name, address, rating, website, the "why it matches" line, and direction links for **Drive · Motorcycle · Commute · Walk**.

## Stack (fixed)

- Node 24, plain JavaScript (ES modules), **Express** for routes and static files, and **pg** for Postgres. Add no other runtime dependencies.
- Env loading via `node --env-file=.env` (no dotenv).
- Gemini and Places are called from the server with the built-in `fetch` (no SDKs).
- Frontend: plain `index.html` + `app.js` + `style.css` in `public/`, with the Maps JavaScript API loaded from Google. No framework, no build step.
- Tests: `node --test` with `fetch` mocked. DB tests are skipped when `DATABASE_URL` is unset.

## File layout

```
server/index.js      Express app: routes, static files, applies schema.sql on startup
server/gemini.js     extractProfile(pdfBase64) -> profile JSON
server/places.js     searchPlaces(query, lat, lng) -> companies[], cached in Postgres
server/db.js         pg Pool from DATABASE_URL
server/schema.sql    idempotent (CREATE TABLE IF NOT EXISTS)
server/*.test.js
public/index.html, public/app.js, public/style.css
.env.example         every variable below, no real values
package.json         scripts: start, test
README.md            setup + run steps
```

## Environment variables

| Name | Used by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | server | Paid tier (resumes are personal data) |
| `GEMINI_MODEL` | server | Current Flash model name |
| `PLACES_API_KEY` | server | Restricted to Places API (New) |
| `MAPS_BROWSER_KEY` | browser via `/api/config` | Restricted to Maps JavaScript API + HTTP referrers |
| `DATABASE_URL` | server | Local Postgres or Neon/Supabase |
| `PORT` | server | Default 3000 |

## API contract (both builders code against this)

`GET /api/config` → `{ "mapsBrowserKey": "..." }`

`POST /api/search` with JSON body `{ "pdfBase64": "...", "lat": 14.55, "lng": 121.02 }`

→ 200:
```json
{
  "profile": { "titles": ["..."], "skills": ["..."], "industries": ["..."] },
  "companies": [{
    "placeId": "...", "name": "...", "address": "...",
    "lat": 14.55, "lng": 121.02, "rating": 4.5,
    "website": "https://...", "mapsUrl": "https://...",
    "query": "fintech company", "why": "Matches your Python + payments experience"
  }]
}
```
→ 400 `{ "error": "..." }` for bad input; 502 `{ "error": "..." }` when Gemini or Places fails.

## Gemini

- Send the PDF as inline data (`mimeType: application/pdf`) using structured output (`responseMimeType: application/json` + a response schema) shaped as `{ titles[], skills[], industries[], searchQueries: [{ query, why }] }`.
- Queries must be things Google Maps can find as places, such as "software company" or "BPO company" or "bank", not job titles. Cap at 5.
- Validate the response shape before using it.

## Places

- Places API (New) Text Search: `POST https://places.googleapis.com/v1/places:searchText` with `textQuery`, `regionCode: "PH"`, `locationBias.circle` (center = user, radius 10 km), `maxResultCount: 10`.
- Always send an `X-Goog-FieldMask` listing only the fields in the contract. This keeps calls in a cheaper pricing tier.
- **Cache** table keyed by `(query, round(lat,2), round(lng,2))` with a `jsonb` results column and `fetched_at`. Reuse rows younger than **30 days**; Google's terms limit how long Places content may be cached. Shortcut comment required on this limit.

## Directions

Use Google Maps URLs, not the Directions API:
`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&destination_place_id=ID&travelmode=MODE`
Modes: `driving`, `two-wheeler` (Motorcycle; very common in PH), `transit` (Commute), `walking`.

## Non-negotiables

- **Resumes are never stored or logged**: no disk writes, no DB rows, no console output of PDF bytes or extracted text. This matters under the PH Data Privacy Act (RA 10173).
- Validate at the boundary: body ≤ 7 MB, decoded PDF ≤ 5 MB, decoded bytes start with `%PDF`, lat/lng are finite numbers inside the Philippines' rough bounding box (lat 4–22, lng 116–127).
- Server keys never reach the browser. `.env` is gitignored.
- No HTML injection: build popup content with `textContent`/DOM nodes, not `innerHTML` with API data.
- Accessible: labelled file input, real `<button>`s, keyboard-reachable results list next to the map (not markers alone).

## Out of scope (do not build)

Accounts/login, saved companies, job-listing APIs (later: **Jooble** or **Careerjet**, which cover PH; Adzuna does not), in-map route drawing, rate limiting (note it in README as required before public launch), deployment.

## Phases

1. **Lead (you):** create `package.json`, `.env.example`, `.gitignore`, empty `server/` and `public/` folders. Run `npm install express pg`.
2. **In parallel:** spawn `backend-builder` (owns `server/`) and `frontend-builder` (owns `public/`). Give each this whole prompt. They must not edit each other's folders.
3. **Lead:** run `npm test`, then start the app. If `.env` has real keys, do one real search from a Manila location and check markers + links. If keys are missing, say so and stop there.
4. **Spawn `reviewer`** to audit the result against the Non-negotiables. Fix what it finds.
5. **Lead:** write `README.md` (setup, keys → `docs/setup-keys.md`, run, test, known limits). Commit only when the user asks.

## Definition of done

- `npm test` passes.
- `npm start` serves the page. Uploading a resume shows markers within ~15 s, and each marker has 4 working direction links.
- A second identical search makes **no** Places call (cache hit, verified in a test).
- The reviewer reports no unresolved high-severity findings.
