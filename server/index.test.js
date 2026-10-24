import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.DATABASE_URL; // route tests never touch a real cache
process.env.MAPS_BROWSER_KEY = 'browser-key';
process.env.PLACES_API_KEY = 'secret-places-key';
process.env.GEMINI_API_KEY = 'secret-gemini-key';
const { app } = await import('./index.js');

const realFetch = globalThis.fetch;
let server, base;
before(() => new Promise((ok) => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
after(() => { server.closeAllConnections(); server.close(); });

const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
const post = (body) => realFetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const profile = { titles: ['Dev'], skills: ['JS'], industries: ['Tech'], searchQueries: [{ query: 'software company', why: 'You code' }, { query: 'IT company', why: 'You know IT' }] };
const place = (id) => ({ id, displayName: { text: id }, formattedAddress: 'Makati', location: { latitude: 14.55, longitude: 121.02 } });
const upstream = async (url) => url.includes('generativelanguage')
  ? Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(profile) }] } }] })
  : Response.json({ places: [place('A'), place('B')] });

test('GET /api/config returns only the browser key', async () => {
  const res = await realFetch(`${base}/api/config`);
  assert.deepEqual(await res.json(), { mapsBrowserKey: 'browser-key' });
});

test('POST /api/search rejects bad input with 400 JSON', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', upstream);
  const big = Buffer.alloc(5 * 1024 * 1024 + 1); big.write('%PDF');
  for (const body of [
    {},
    { pdfBase64: pdf, lat: '14.5', lng: 121 },
    { pdfBase64: pdf, lat: 35.6, lng: 139.7 }, // Tokyo
    { pdfBase64: pdf, lat: NaN, lng: 121 },
    { pdfBase64: Buffer.from('hello').toString('base64'), lat: 14.55, lng: 121.02 },
    { pdfBase64: big.toString('base64'), lat: 14.55, lng: 121.02 },
    '{not json',
    JSON.stringify({ pdfBase64: 'x'.repeat(7 * 1024 * 1024 + 1), lat: 14.55, lng: 121.02 }),
  ]) {
    const res = await post(body);
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).error, 'string');
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('POST /api/search returns profile + companies deduped by place ID, with no keys', async (t) => {
  t.mock.method(globalThis, 'fetch', upstream);
  const res = await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /secret-/);
  const { profile: p, companies } = JSON.parse(text);
  assert.deepEqual(p, { titles: ['Dev'], skills: ['JS'], industries: ['Tech'] });
  assert.deepEqual(companies.map((c) => c.placeId), ['A', 'B']);
  assert.equal(companies[0].why, 'You code');
});

test('POST /api/search returns 502 when Gemini or Places fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 500 }));
  assert.equal((await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 })).status, 502);
  t.mock.method(globalThis, 'fetch', async (url) => url.includes('places') ? new Response('{}', { status: 403 }) : upstream(url));
  const res = await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 });
  assert.equal(res.status, 502);
  assert.equal(typeof (await res.json()).error, 'string');
});
