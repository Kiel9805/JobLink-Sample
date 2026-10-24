# Getting the API keys

You need these accounts to be signed in to your Google account with a billing card added, so you have to create them yourself. Paste each value into `.env` (copied from `.env.example`). Never commit `.env` or paste keys into chat.

## 1. Google Cloud project (for Maps + Places)

1. Go to https://console.cloud.google.com/ and create a project, e.g. `joblink`.
2. **Billing → Link a billing account.** Maps requires one even inside the free monthly quota.
3. **APIs & Services → Library**, enable:
   - **Maps JavaScript API**
   - **Places API (New)**. Make sure it says "(New)"; the old one uses different endpoints.
4. **APIs & Services → Credentials → Create credentials → API key**, twice:
   - **Browser key → `MAPS_BROWSER_KEY`**
     - Application restriction: *Websites*, add `http://localhost:3000/*`. Add your real domain later.
     - API restriction: *Maps JavaScript API* only.
   - **Server key → `PLACES_API_KEY`**
     - API restriction: *Places API (New)* only.
     - Application restriction: none for local dev. Set *IP addresses* once it's hosted.
5. Optional but recommended: **Billing → Budgets & alerts**, add a small monthly budget alert.

## 2. Gemini API key

1. Go to https://aistudio.google.com/ → **Get API key** → create it in the `joblink` project from step 1.
2. Turn on billing for it (paid tier) before real users upload resumes. On the free tier, Google may use inputs to improve its products.
3. Put the key in `GEMINI_API_KEY`. Set `GEMINI_MODEL` to the current Flash model name listed in AI Studio.

## 3. Postgres → `DATABASE_URL`

Pick one:
- **Local:** install from https://www.postgresql.org/download/windows/, create a database `joblink`, then
  `DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/joblink`
- **Hosted (no install):** create a free project on Neon (https://neon.tech) or Supabase and copy its connection string.

## Check

The app creates its own table on startup. If `npm start` runs without a DB error and the map loads, the keys work.
