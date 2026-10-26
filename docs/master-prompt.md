# JobLink — Master Prompt

Paste everything below the line into a new Claude Code session opened in this repo.

---

You are the lead developer for **JobLink**, a web app for job seekers in the **Philippines**. The user uploads a resume, AI works out what kinds of workplaces fit them, and a map shows matching companies near them with one-click directions.

Build the MVP described here. Delegate to the sub-agents in `.claude/agents/` as described under **Phases**. Keep it small: no feature, dependency or abstraction that isn't listed here.

## User flow

1. The user opens the page. The browser asks for their location; if they deny it, center on Metro Manila (14.5995, 120.9842) and let them click the map to set a location.
2. The user uploads a PDF resume and clicks **Find companies**.
3. The server sends the PDF to Gemini, which returns job titles, skills, industries, and 3–5 workplace categories (OSM tags from a fixed list), each with a one-line reason.
4. The server searches OpenStreetMap (Nominatim) for each category near the user, using a Postgres cache, and dedupes results.
5. The map shows one marker per company. Clicking a marker shows the name, address, website, the "why it matches" line, and direction links for **Drive · Motorcycle · Commute · Walk**.

## Stack (fixed)

- Node 24, plain JavaScript (ES modules), **Express** for routes and static files, and **pg** for Postgres. Add no other runtime dependencies.
- Env loading via `node --env-file-if-exists=.env` (no dotenv).
- Gemini and Nominatim are called from the server with the built-in `fetch` (no SDKs).
- Frontend: plain `index.html` + `app.js` + `style.css` in `public/`, with **Leaflet 1.9.4** (from unpkg, with SRI) and OpenStreetMap tiles. No framework, no build step.
- Tests: `node --test` with `fetch` mocked. DB tests are skipped when `DATABASE_URL` is unset.

## File layout

```
server/index.js      Express app: routes, static files, applies schema.sql on startup
server/gemini.js     extractProfile(pdfBase64) -> profile JSON
server/places.js     TAGS allowlist; searchPlaces(tags, lat, lng) -> companies[], cached in Postgres
server/db.js         pg Pool from DATABASE_URL (null when unset)
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
| `GEMINI_API_KEY` | server | Paid tier for real users (resumes are personal data) |
| `GEMINI_MODEL` | server | Default `gemini-flash-lite-latest` (Flash with thinking took ~50 s per resume) |
| `JOOBLE_API_KEY` | server | Optional. Live job openings; unset = companies only |
| `DATABASE_URL` | server | Optional. Local Postgres or Neon/Supabase. Unset = no cache |
| `PORT` | server | Default 3000 |

The map and search need no keys.

## API contract

`POST /api/search` with JSON body `{ "pdfBase64": "...", "lat": 14.55, "lng": 121.02 }`

→ 200:
```json
{
  "profile": { "titles": ["..."], "skills": ["..."], "industries": ["..."] },
  "companies": [{
    "placeId": "node/123", "name": "...", "address": "...",
    "lat": 14.55, "lng": 121.02, "website": "https://..." ,
    "why": "Matches your Python + payments experience"
  }],
  "jobs": [{
    "id": "123", "title": "...", "company": "...", "location": "...",
    "salary": "...", "snippet": "plain text", "link": "https://jooble.org/..."
  }]
}
```
`jobs` is `[]` when `JOOBLE_API_KEY` is unset or Jooble fails. A Jooble failure never fails the request.

## Jobs (Jooble)

- `POST https://ph.jooble.org/api/<JOOBLE_API_KEY>` (keys are per country; register on ph.jooble.org) with `{ keywords: <first job title>, location: "<city>" }`. The city comes from a Nominatim reverse lookup that shares the throttle.
- Strip HTML from Jooble fields on the server and cap at 20. Never log the URL, because it contains the key.
→ 400 `{ "error": "..." }` for bad input; 502 `{ "error": "..." }` when Gemini or Nominatim fails.

## Gemini

- Send the PDF as inline data (`mimeType: application/pdf`) using structured output (`responseMimeType: application/json` + a response schema) shaped as `{ titles[], skills[], industries[], searchQueries: [{ tag, why }] }`.
- `tag` is an enum of the `TAGS` allowlist in `server/places.js` (e.g. `office=it`, `amenity=bank`, `office=company`). Drop unknown or repeated tags; cap at 5.
- Validate the response shape before using it.

## Search (Nominatim)

- `GET https://nominatim.openstreetmap.org/search?q=[<tag>]&viewbox=<~10 km box>&bounded=1&format=jsonv2&addressdetails=1&extratags=1&limit=40`, one request per tag.
- **Usage policy:** at most 1 request/second from the server across all users (global throttle), an identifying `User-Agent`, cache results, show attribution.
- Only allowlisted tags ever reach the query.
- Dedupe by `osm_type/osm_id`. Give each tag an equal share of the 50 results, nearest first.
- **Cache** one row per tag, keyed by `(tag, round(lat,2), round(lng,2))` so searches sharing a tag reuse it, with a `jsonb` results column and `fetched_at`. Reuse rows younger than 30 days. A cache failure must fall back to a live search, never fail it.
- Overpass was tried first and dropped: the public servers took 25–60+ s or timed out.

## Directions

- **Route on map (Drive, Walk):** the browser calls FOSSGIS's free OSRM servers, `https://routing.openstreetmap.de/{routed-car|routed-foot}/route/v1/{driving|foot}/LNG,LAT;LNG,LAT?overview=full&geometries=geojson`, draws the line with Leaflet, and shows distance and time (driving: "without traffic"). Google's Directions API isn't an option: its terms only allow routes on a Google map.
- **Navigate in Google Maps** (free, no key):
`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=MODE`
Modes: `driving`, `two-wheeler` (Motorcycle; very common in PH), `transit` (Commute), `walking`.

## Non-negotiables

- **Resumes are never stored or logged**: no disk writes, no DB rows, no console output of PDF bytes or extracted text. This matters under the PH Data Privacy Act (RA 10173).
- Validate at the boundary: body ≤ 7 MB, decoded PDF ≤ 5 MB, decoded bytes start with `%PDF`, lat/lng are finite numbers inside the Philippines' rough bounding box (lat 4–22, lng 116–127).
- `GEMINI_API_KEY` never reaches the browser. `.env*` is gitignored (except `.env.example`).
- No HTML injection: build popup content with `textContent`/DOM nodes, not `innerHTML` with API data.
- Accessible: labelled file input, real `<button>`s, keyboard-reachable results list next to the map (not markers alone).

## Out of scope (do not build)

Accounts/login, saved companies, more job sources (Careerjet; Adzuna doesn't cover PH), in-map route drawing, deployment. Rate limiting: 10 valid searches per IP per hour (in memory; `TRUST_PROXY=1` behind a host proxy).

## Phases

1. **Lead (you):** create `package.json`, `.env.example`, `.gitignore`, empty `server/` and `public/` folders. Run `npm install express pg`.
2. **In parallel:** spawn `backend-builder` (owns `server/`) and `frontend-builder` (owns `public/`). Give each this whole prompt. They must not edit each other's folders.
3. **Lead:** run `npm test`, then start the app and do one real search from a Manila location; check markers + links.
4. **Spawn `reviewer`** to audit the result against the Non-negotiables. Fix what it finds.
5. **Lead:** write `README.md` (setup, keys → `docs/setup-keys.md`, run, test, known limits). Commit only when the user asks.

## Definition of done

- `npm test` passes.
- `npm start` serves the page. Uploading a resume shows markers within ~15 s, and each marker has 4 working direction links.
- A second identical search makes **no** Nominatim call (cache hit, verified in a test).
- The reviewer reports no unresolved high-severity findings.
