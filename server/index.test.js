import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.DATABASE_URL; // route tests never touch a real cache
process.env.JOOBLE_API_KEY = 'secret-jooble-key';
process.env.GEMINI_API_KEY = 'secret-gemini-key';
const { app } = await import('./index.js');
(await import('./places.js')).throttle.gapMs = 0;

const realFetch = globalThis.fetch;
let server, base;
before(() => new Promise((ok) => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
after(() => { server.closeAllConnections(); server.close(); });

const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
const post = (body) => realFetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const profile = { titles: ['Dev'], skills: ['JS'], industries: ['Tech'], searchQueries: [{ tag: 'office=it', why: 'You code' }, { tag: 'amenity=bank', why: 'You know finance' }] };
const result = (id) => ({ osm_type: 'node', osm_id: id, name: `Co ${id}`, lat: '14.55', lon: '121.02' });
const upstream = async (url) => {
  if (String(url).includes('generativelanguage')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(profile) }] } }] });
  if (String(url).includes('jooble')) return Response.json({ jobs: [{ id: 9, title: 'Dev', company: 'Co 1', link: 'https://jooble.org/desc/9' }] });
  if (url.pathname === '/reverse') return Response.json({ address: { city: 'Makati' } });
  return Response.json([result(url.searchParams.get('q') === '[office=it]' ? 1 : 2)]);
};

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

test('POST /api/search returns profile + companies with their "why", and no keys', async (t) => {
  t.mock.method(globalThis, 'fetch', upstream);
  const res = await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /secret-/);
  const { profile: p, companies } = JSON.parse(text);
  assert.deepEqual(p, { titles: ['Dev'], skills: ['JS'], industries: ['Tech'] });
  assert.deepEqual(companies.map((c) => [c.placeId, c.why]), [['node/1', 'You code'], ['node/2', 'You know finance']]);
  assert.ok(companies.every((c) => !('tag' in c)));
  assert.deepEqual(JSON.parse(text).jobs.map((j) => j.title), ['Dev']);
});

test('POST /api/search still returns companies when Jooble fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('jooble') ? new Response('', { status: 500 }) : upstream(url));
  const res = await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.companies.length, 2);
  assert.deepEqual(body.jobs, []);
});

test('POST /api/search returns 502 when Gemini or Nominatim fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 500 }));
  assert.equal((await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 })).status, 502);
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('nominatim') ? new Response('', { status: 429 }) : upstream(url));
  const res = await post({ pdfBase64: pdf, lat: 14.55, lng: 121.02 });
  assert.equal(res.status, 502);
  assert.equal(typeof (await res.json()).error, 'string');
});
