import { pool } from './db.js';

// Only the fields the API contract needs. rating and websiteUri still bill at the Enterprise SKU; drop them to cut cost.
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.websiteUri,places.googleMapsUri';

// db is anything with pg's query(text, params); null disables the cache.
export async function searchPlaces(query, lat, lng, db = pool) {
  const key = [query.trim().toLowerCase(), lat.toFixed(2), lng.toFixed(2)];

  if (db) {
    // shortcut: rows older than 30 days (Google's Places caching limit) are ignored but never purged; add a periodic DELETE if the table grows.
    // A broken cache must not break search: fall through to Places.
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

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.PLACES_API_KEY ?? '',
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: 'PH',
      maxResultCount: 10,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 10000 } },
    }),
  });
  if (!res.ok) throw new Error(`Places request failed (${res.status})`);
  const { places = [] } = await res.json();

  const companies = places.filter((p) => p.id && p.location).map((p) => ({
    placeId: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    lat: p.location.latitude,
    lng: p.location.longitude,
    rating: p.rating ?? null,
    website: p.websiteUri ?? null,
    mapsUrl: p.googleMapsUri ?? null,
    query,
  }));

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
