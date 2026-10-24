import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchPlaces } from './places.js';
import { pool } from './db.js';

const placesReply = async () => Response.json({ places: [
  { id: 'A', displayName: { text: 'Acme' }, formattedAddress: 'Makati', location: { latitude: 14.55, longitude: 121.02 }, rating: 4.5, websiteUri: 'https://acme.ph', googleMapsUri: 'https://maps.google.com/?cid=1' },
] });

// Stand-in for pg: same query(text, params) interface, keyed on the params.
function fakeDb() {
  const rows = new Map();
  return { query: async (sql, params) => {
    const key = params.slice(0, 3).join('|');
    if (sql.startsWith('SELECT')) return { rows: rows.has(key) ? [{ results: rows.get(key) }] : [] };
    rows.set(key, JSON.parse(params[3]));
    return { rows: [] };
  } };
}

test('maps Places results to the contract shape and sends the right request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', placesReply);
  const [c] = await searchPlaces('software company', 14.5512, 121.0234, null);
  assert.deepEqual(c, { placeId: 'A', name: 'Acme', address: 'Makati', lat: 14.55, lng: 121.02, rating: 4.5, website: 'https://acme.ph', mapsUrl: 'https://maps.google.com/?cid=1', query: 'software company' });
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
  assert.match(init.headers['X-Goog-FieldMask'], /^places\.id,/);
  const body = JSON.parse(init.body);
  assert.equal(body.regionCode, 'PH');
  assert.equal(body.locationBias.circle.radius, 10000);
});

test('a second identical search is a cache hit with no Places call', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', placesReply);
  const db = fakeDb();
  const first = await searchPlaces('bank', 14.5512, 121.0234, db);
  const second = await searchPlaces('Bank ', 14.5549, 121.0201, db); // same key after normalising + rounding
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(second, first);
});

test('a failing cache falls back to Places instead of failing the search', async (t) => {
  t.mock.method(globalThis, 'fetch', placesReply);
  t.mock.method(console, 'error', () => {});
  const brokenDb = { query: async () => { throw new Error('connection refused'); } };
  const [c] = await searchPlaces('bank', 14.55, 121.02, brokenDb);
  assert.equal(c.placeId, 'A');
});

test('throws on a failed Places call', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 403 }));
  await assert.rejects(searchPlaces('bank', 14.55, 121.02, null), /Places request failed \(403\)/);
});

test('Postgres cache round-trip', { skip: !process.env.DATABASE_URL && 'DATABASE_URL is not set' }, async (t) => {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const query = `joblink test ${Date.now()}`;
  t.after(async () => { await pool.query('DELETE FROM places_cache WHERE query = $1', [query]); await pool.end(); });
  const fetchMock = t.mock.method(globalThis, 'fetch', placesReply);
  await searchPlaces(query, 14.55, 121.02);
  const cached = await searchPlaces(query, 14.55, 121.02);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(cached[0].placeId, 'A');
});
