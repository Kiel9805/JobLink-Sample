import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { extractProfile } from './gemini.js';
import { searchPlaces } from './places.js';

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const inPH = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 4 && lat <= 22 && lng >= 116 && lng <= 127;

export const app = express();
app.use(express.json({ limit: '7mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.get('/api/config', (req, res) => res.json({ mapsBrowserKey: process.env.MAPS_BROWSER_KEY ?? '' }));

app.post('/api/search', async (req, res) => {
  const { pdfBase64, lat, lng } = req.body ?? {};
  if (typeof pdfBase64 !== 'string' || !pdfBase64) return res.status(400).json({ error: 'pdfBase64 is required' });
  if (typeof lat !== 'number' || typeof lng !== 'number' || !inPH(lat, lng)) {
    return res.status(400).json({ error: 'lat/lng must be numbers inside the Philippines' });
  }
  const pdf = Buffer.from(pdfBase64.replace(/^data:[^,]*,/, ''), 'base64');
  if (pdf.length > MAX_PDF_BYTES) return res.status(400).json({ error: 'PDF must be 5 MB or smaller' });
  if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') return res.status(400).json({ error: 'File is not a PDF' });

  let profile;
  try {
    profile = await extractProfile(pdf.toString('base64'));
  } catch (err) {
    console.error(err.message); // our own messages only; never resume content
    return res.status(502).json({ error: 'Could not read the resume with Gemini' });
  }

  try {
    // Near-duplicate queries ("bank" / "Bank ") would each pay for a Places call.
    const queries = [...new Map(profile.searchQueries.map((q) => [q.query.trim().toLowerCase(), q])).values()];
    const lists = await Promise.all(queries.map(({ query, why }) =>
      searchPlaces(query, lat, lng).then((cs) => cs.map((c) => ({ ...c, query, why })))));
    const byId = new Map();
    for (const c of lists.flat()) if (!byId.has(c.placeId)) byId.set(c.placeId, c);
    const { titles, skills, industries } = profile;
    res.json({ profile: { titles, skills, industries }, companies: [...byId.values()] });
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
