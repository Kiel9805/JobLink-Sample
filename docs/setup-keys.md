# Getting the keys

JobLink needs only **one** API key (Gemini). Jooble is optional, for live job openings. The map (OpenStreetMap) and company search (Nominatim) are free and keyless. Paste values into `.env` (copied from `.env.example`). Never commit `.env` or paste keys into chat.

## 1. Gemini API key → `GEMINI_API_KEY`

1. Go to https://aistudio.google.com/ → **Get API key** → create one.
2. Turn on billing for it (paid tier) before real users upload resumes. On the free tier, Google may use inputs to improve its products.
3. Leave `GEMINI_MODEL=gemini-flash-lite-latest` unless you have a reason to change it. In testing, the bigger Flash model took about 50 s per resume, while Flash-Lite took about 6 s.

## 2. Jooble API key → `JOOBLE_API_KEY` (optional)

Without it, JobLink shows companies only.
1. Go to **https://ph.jooble.org/api/about** (the Philippine site, not jooble.org, because keys are per country and a US key gets 403 here) and fill in the **How to get started?** form. Position: your role (e.g. Developer). Website: your GitHub repo URL if the app isn't hosted yet. Jooble emails you a key.
2. Paste the key into `JOOBLE_API_KEY` in `.env` and restart the app.

## 3. Postgres → `DATABASE_URL` (optional)

Without it the app works, but every search hits Nominatim again. Pick one:
- **Local:** install from https://www.postgresql.org/download/windows/, create a database `joblink`, then
  `DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/joblink`
- **Hosted (no install):** create a free project on Neon (https://neon.tech) or Supabase and copy its connection string.

## Check

The app creates its own table on startup. If `npm start` runs without a DB error and a test resume shows markers, everything works.
