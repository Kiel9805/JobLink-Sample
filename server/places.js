import { pool } from './db.js';

// OSM categories Gemini may pick from. Only these ever reach the Nominatim query.
export const TAGS = {
  'office=it': 'IT / software companies',
  'office=company': 'Company offices, including BPOs',
  'office=financial': 'Financial services',
  'amenity=bank': 'Banks',
  'office=insurance': 'Insurance companies',
  'office=accountant': 'Accounting firms',
  'office=lawyer': 'Law firms',
  'office=advertising_agency': 'Advertising and marketing agencies',
  'office=telecommunication': 'Telecom companies',
  'office=engineer': 'Engineering firms',
  'office=architect': 'Architecture firms',
  'office=logistics': 'Logistics companies',
  'office=employment_agency': 'Recruitment agencies',
  'office=estate_agent': 'Real estate',
  'office=government': 'Government offices',
  'office=ngo': 'NGOs',
  'amenity=hospital': 'Hospitals',
  'amenity=clinic': 'Clinics',
  'amenity=school': 'Schools',
  'amenity=college': 'Colleges',
  'amenity=university': 'Universities',
  'tourism=hotel': 'Hotels',
  'amenity=restaurant': 'Restaurants',
  'shop=supermarket': 'Supermarkets',
  'shop=mall': 'Shopping malls',
  'man_made=works': 'Factories and plants',
};

const RADIUS_DEG = 0.09; // ~10 km
const MAX_RESULTS = 50;
// Nominatim's usage policy: at most 1 request per second from this server, across all users.
export const throttle = { gapMs: 1100 };
let nextSlot = 0;

async function nominatim(path, params) {
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Date.now() + wait + throttle.gapMs;
  if (wait) await new Promise((ok) => setTimeout(ok, wait));

  const url = new URL(path, 'https://nominatim.openstreetmap.org');
  url.search = new URLSearchParams({ ...params, format: 'jsonv2' });
  // The policy also asks clients to identify themselves.
  const res = await fetch(url, { headers: { 'User-Agent': 'JobLink/0.1 (https://github.com/Kiel9805/JobLink-Sample)' } });
  if (!res.ok) throw new Error(`Nominatim request failed (${res.status})`);
  return res.json();
}

async function searchTag(tag, lat, lng) {
  const dLng = RADIUS_DEG / Math.cos((lat * Math.PI) / 180);
  const results = await nominatim('/search', {
    q: `[${tag}]`, // special-phrase syntax: places with this OSM tag
    viewbox: [lng - dLng, lat + RADIUS_DEG, lng + dLng, lat - RADIUS_DEG].join(','),
    bounded: '1',
    addressdetails: '1',
    extratags: '1',
    limit: '40',
  });
  return results.map((r) => ({ ...r, tag }));
}

// City name at a point (for job searches), or null.
export async function cityAt(lat, lng) {
  const { address: a = {} } = await nominatim('/reverse', { lat, lon: lng, zoom: '10' });
  return a.city ?? a.town ?? a.municipality ?? a.state ?? null;
}

function address(a = {}) {
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  return [street, a.suburb, a.city ?? a.town ?? a.municipality].filter(Boolean).join(', ');
}

// One Nominatim search per tag; db is anything with pg's query(text, params), null disables the cache.
export async function searchPlaces(tags, lat, lng, db = pool) {
  if (!tags.length || !tags.every((t) => Object.hasOwn(TAGS, t))) throw new Error('Unknown OSM tag');
  const key = [[...tags].sort().join(','), lat.toFixed(2), lng.toFixed(2)];

  if (db) {
    // shortcut: rows older than 30 days are ignored but never purged; add a periodic DELETE if the table grows.
    // A broken cache must not break search: fall through to Nominatim.
    try {
      const { rows } = await db.query(
        `SELECT results FROM places_cache WHERE query = $1 AND lat = $2 AND lng = $3 AND fetched_at > now() - interval '30 days'`,
        key,
      );
      if (rows.length) return rows[0].results;
    } catch (err) {
      console.error(`Places cache read failed: ${err.message}`);
    }
  }

  const results = [];
  for (const tag of tags) results.push(...await searchTag(tag, lat, lng)); // sequential: see throttle

  const kx = Math.cos((lat * Math.PI) / 180); // longitude degrees shrink away from the equator
  const byId = new Map();
  for (const r of results) {
    const c = { placeId: `${r.osm_type}/${r.osm_id}`, name: r.name, address: address(r.address), lat: Number(r.lat), lng: Number(r.lon),
      website: r.extratags?.website ?? r.extratags?.['contact:website'] ?? null, tag: r.tag };
    if (c.name && Number.isFinite(c.lat) && Number.isFinite(c.lng) && !byId.has(c.placeId)) byId.set(c.placeId, c);
  }
  const dist = (c) => Math.hypot(c.lat - lat, (c.lng - lng) * kx);
  // Equal share per tag, so dense categories (banks) don't crowd out the rest.
  const perTag = Math.ceil(MAX_RESULTS / tags.length);
  const companies = tags
    .flatMap((tag) => [...byId.values()].filter((c) => c.tag === tag).sort((a, b) => dist(a) - dist(b)).slice(0, perTag))
    .sort((a, b) => dist(a) - dist(b))
    .slice(0, MAX_RESULTS);

  if (db) {
    try {
      await db.query(
        `INSERT INTO places_cache (query, lat, lng, results) VALUES ($1, $2, $3, $4)
         ON CONFLICT (query, lat, lng) DO UPDATE SET results = EXCLUDED.results, fetched_at = now()`,
        [...key, JSON.stringify(companies)],
      );
    } catch (err) {
      console.error(`Places cache write failed: ${err.message}`);
    }
  }
  return companies;
}
