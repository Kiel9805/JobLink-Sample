import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchPlaces, throttle } from './places.js';
import { pool } from './db.js';

throttle.gapMs = 0; // tests mock fetch, so there is no server to be polite to

const results = {
  'office=it': [
    { osm_type: 'node', osm_id: 1, name: 'Acme', lat: '14.5513', lon: '121.0235', address: { house_number: '6750', road: 'Ayala Ave', city: 'Makati' }, extratags: { website: 'https://acme.ph' } },
    { osm_type: 'node', osm_id: 3, name: '', lat: '14.552', lon: '121.024' }, // unnamed: dropped
  ],
  'amenity=bank': [
    { osm_type: 'way', osm_id: 2, name: 'Far Bank', lat: '14.60', lon: '121.05', address: {}, extratags: {} },
    { osm_type: 'node', osm_id: 1, name: 'Acme', lat: '14.5513', lon: '121.0235' }, // same place twice: kept once
  ],
};
const nominatimReply = async (url) => Response.json(results[new URL(url).searchParams.get('q').slice(1, -1)] ?? []);

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

test('maps Nominatim results to the contract shape, deduped, nearest first, with the right request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', nominatimReply);
  const companies = await searchPlaces(['office=it', 'amenity=bank'], 14.5512, 121.0234, null);
  assert.deepEqual(companies, [
    { placeId: 'node/1', name: 'Acme', address: '6750 Ayala Ave, Makati', lat: 14.5513, lng: 121.0235, website: 'https://acme.ph', tag: 'office=it' },
    { placeId: 'way/2', name: 'Far Bank', address: '', lat: 14.60, lng: 121.05, website: null, tag: 'amenity=bank' },
  ]);
  assert.equal(fetchMock.mock.callCount(), 2);
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), '[office=it]');
  assert.equal(url.searchParams.get('bounded'), '1');
  const [left, top, right, bottom] = url.searchParams.get('viewbox').split(',').map(Number);
  assert.ok(left < 121.0234 && right > 121.0234 && bottom < 14.5512 && top > 14.5512);
  assert.match(init.headers['User-Agent'], /^JobLink\//);
});

test('gives each tag an equal share of the 50 results', async (t) => {
  const many = (tag, n, offset) => Array.from({ length: n }, (_, i) => ({ osm_type: 'node', osm_id: offset + i, name: `${tag} ${i}`, lat: String(14.55 + (offset ? 0.05 : 0) + i / 1e4), lon: '121.02' }));
  t.mock.method(globalThis, 'fetch', async (url) => Response.json(url.searchParams.get('q') === '[amenity=bank]' ? many('bank', 40, 0) : many('it', 40, 1000)));
  const companies = await searchPlaces(['amenity=bank', 'office=it'], 14.55, 121.02, null);
  assert.equal(companies.length, 50);
  assert.equal(companies.filter((c) => c.tag === 'office=it').length, 25); // IT is farther but still gets its share
});

test('rejects tags outside the allowlist without calling Nominatim', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', nominatimReply);
  await assert.rejects(searchPlaces(['office=it', 'shop=bakery'], 14.55, 121.02, null), /Unknown OSM tag/);
  await assert.rejects(searchPlaces([], 14.55, 121.02, null), /Unknown OSM tag/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('spaces requests at least gapMs apart', async (t) => {
  const times = [];
  t.mock.method(globalThis, 'fetch', async (url) => { times.push(Date.now()); return nominatimReply(url); });
  throttle.gapMs = 50;
  t.after(() => { throttle.gapMs = 0; });
  await searchPlaces(['office=it', 'amenity=bank'], 14.55, 121.02, null);
  assert.ok(times[1] - times[0] >= 45, `gap was ${times[1] - times[0]}ms`);
});

test('a second identical search is a cache hit with no Nominatim call', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', nominatimReply);
  const db = fakeDb();
  const first = await searchPlaces(['office=it', 'amenity=bank'], 14.5512, 121.0234, db);
  const second = await searchPlaces(['office=it', 'amenity=bank'], 14.5549, 121.0201, db); // same keys after rounding
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.deepEqual(second, first);
  await searchPlaces(['office=it', 'office=company'], 14.5512, 121.0234, db); // overlaps: only the new tag is fetched
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.equal(fetchMock.mock.calls[2].arguments[0].searchParams.get('q'), '[office=company]');
});

test('a failing cache falls back to Nominatim instead of failing the search', async (t) => {
  t.mock.method(globalThis, 'fetch', nominatimReply);
  t.mock.method(console, 'error', () => {});
  const brokenDb = { query: async () => { throw new Error('connection refused'); } };
  const [c] = await searchPlaces(['office=it'], 14.55, 121.02, brokenDb);
  assert.equal(c.placeId, 'node/1');
});

test('throws on a failed Nominatim call', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  await assert.rejects(searchPlaces(['amenity=bank'], 14.55, 121.02, null), /Nominatim request failed \(429\)/);
});

test('Postgres cache round-trip', { skip: !process.env.DATABASE_URL && 'DATABASE_URL is not set' }, async (t) => {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const lng = 0.01; // outside the PH box the API allows, so no real cache row uses it
  const clear = () => pool.query('DELETE FROM places_cache WHERE lng = $1', [lng]);
  await clear();
  t.after(async () => { await clear(); await pool.end(); });
  const fetchMock = t.mock.method(globalThis, 'fetch', nominatimReply);
  await searchPlaces(['office=it'], 14.55, lng);
  const cached = await searchPlaces(['office=it'], 14.55, lng);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(cached[0].placeId, 'node/1');
});
