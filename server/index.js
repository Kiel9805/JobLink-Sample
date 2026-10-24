import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { extractProfile } from './gemini.js';
import { searchPlaces } from './places.js';
import { findJobs } from './jobs.js';

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const inPH = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 4 && lat <= 22 && lng >= 116 && lng <= 127;

// Each search costs a Gemini call, so cap valid searches per IP.
// shortcut: in-memory counts reset on restart and aren't shared between instances; move to Postgres if you run more than one.
const SEARCHES_PER_HOUR = 10;
const searches = new Map(); // ip -> { count, resetAt }
function overLimit(ip) {
  const now = Date.now();
  if (searches.size > 10000) for (const [k, v] of searches) if (v.resetAt <= now) searches.delete(k);
  const s = searches.get(ip);
  if (!s || s.resetAt <= now) {
    searches.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  return ++s.count > SEARCHES_PER_HOUR;
}

export const app = express();
// Behind a host's proxy (e.g. Render), set TRUST_PROXY=1 so req.ip is the visitor, not the proxy. Never set it without a proxy: visitors could fake their IP.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.use(express.json({ limit: '7mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.post('/api/search', async (req, res) => {
  const { pdfBase64, lat, lng } = req.body ?? {};
  if (typeof pdfBase64 !== 'string' || !pdfBase64) return res.status(400).json({ error: 'pdfBase64 is required' });
  if (typeof lat !== 'number' || typeof lng !== 'number' || !inPH(lat, lng)) {
    return res.status(400).json({ error: 'lat/lng must be numbers inside the Philippines' });
  }
  const pdf = Buffer.from(pdfBase64.replace(/^data:[^,]*,/, ''), 'base64');
  if (pdf.length > MAX_PDF_BYTES) return res.status(400).json({ error: 'PDF must be 5 MB or smaller' });
  if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') return res.status(400).json({ error: 'File is not a PDF' });
  if (overLimit(req.ip)) return res.status(429).json({ error: `You've reached ${SEARCHES_PER_HOUR} searches this hour. Please try again later.` });

  let profile;
  try {
    profile = await extractProfile(pdf.toString('base64'));
  } catch (err) {
    console.error(err.message); // our own messages only; never resume content
    return res.status(502).json({ error: 'Could not read the resume with Gemini' });
  }

  try {
    const whyByTag = new Map(profile.searchQueries.map(({ tag, why }) => [tag, why]));
    const [places, jobs] = await Promise.all([
      searchPlaces([...whyByTag.keys()], lat, lng),
      // Job listings are a bonus: their failure must not lose the company results.
      findJobs(profile.titles[0], lat, lng).catch((err) => { console.error(err.message); return []; }),
    ]);
    const companies = places.map(({ tag, ...c }) => ({ ...c, why: whyByTag.get(tag) }));
    const { titles, skills, industries } = profile;
    res.json({ profile: { titles, skills, industries }, companies, jobs });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: 'Could not search for companies' });
  }
});

// Malformed or oversized JSON bodies: answer with JSON, and never log the body.
app.use((err, req, res, next) => {
  if (err.status >= 400 && err.status < 500) {
    return res.status(400).json({ error: err.type === 'entity.too.large' ? 'Request is too large' : 'Invalid request body' });
  }
  console.error(err.message);
  res.status(500).json({ error: 'Server error' });
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (pool) {
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    } catch (err) {
      console.warn(`Could not apply schema.sql: ${err.message}`);
    }
  } else {
    console.warn('DATABASE_URL is not set: Places results will not be cached.');
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`JobLink on http://localhost:${port}`));
}
