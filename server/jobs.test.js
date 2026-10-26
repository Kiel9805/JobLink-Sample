import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { findJobs, newJobs } from './jobs.js';
import { throttle } from './places.js';

throttle.gapMs = 0;
beforeEach(() => { process.env.JOOBLE_API_KEY = 'secret-jooble-key'; });

const joobleJobs = [
  { id: 7, title: 'Full Stack <b>Developer</b>', company: 'Acme &amp; Co', location: 'Makati', salary: '₱60k', snippet: '&nbsp;Build <b>React</b> apps', link: 'https://jooble.org/desc/7', updated: '2026-10-25T08:00:00.0000000' },
  { id: 9, title: 'Data Analyst', company: 'Beta', location: 'Makati', link: 'https://jooble.org/desc/9', updated: '2026-10-26T23:36:12.2689455+00:00' },
  { id: 8, title: '', link: 'https://jooble.org/desc/8' }, // no title: dropped
];
const upstream = async (url) => String(url).includes('nominatim')
  ? Response.json({ address: { city: 'Makati' } })
  : Response.json({ totalCount: 2, jobs: joobleJobs });

test('returns [] without calling anything when JOOBLE_API_KEY is unset', async (t) => {
  delete process.env.JOOBLE_API_KEY;
  const fetchMock = t.mock.method(globalThis, 'fetch', upstream);
  assert.deepEqual(await findJobs('Developer', 14.55, 121.02), []);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('searches the title in the nearest city and returns plain-text jobs', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', upstream);
  const jobs = await findJobs('Full Stack Developer', 14.55, 121.02);
  assert.equal(jobs.length, 2);
  assert.deepEqual({ ...jobs[0], posted: undefined }, { id: 'https://jooble.org/desc/7', title: 'Full Stack Developer', company: 'Acme & Co', location: 'Makati', salary: '₱60k', snippet: 'Build React apps', link: 'https://jooble.org/desc/7', posted: undefined });
  assert.match(jobs[0].posted, /^2026-10-25T\d\d:00:00\.000Z$/); // Jooble omits the zone on some dates; parsed as local time
  const [reverseUrl] = fetchMock.mock.calls[0].arguments;
  assert.equal(reverseUrl.pathname, '/reverse');
  const [url, init] = fetchMock.mock.calls[1].arguments;
  assert.equal(url, 'https://ph.jooble.org/api/secret-jooble-key');
  assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(init.body), { keywords: 'Full Stack Developer', location: 'Makati' });
});

test('throws without leaking the key when Jooble fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('jooble') ? new Response('', { status: 403 }) : upstream(url));
  await assert.rejects(findJobs('Developer', 14.55, 121.02), (err) => /Jooble request failed \(403\)/.test(err.message) && !err.message.includes('secret'));
});

test('newJobs asks for openings from the last 3 days in the city, newest first', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-27T03:00:00Z') });
  const fetchMock = t.mock.method(globalThis, 'fetch', upstream);
  const { city, jobs } = await newJobs('', 14.55, 121.02);
  assert.equal(city, 'Makati');
  assert.deepEqual(jobs.map((j) => j.title), ['Data Analyst', 'Full Stack Developer']);
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[1].arguments[1].body), { keywords: '', location: 'Makati', datecreatedfrom: '2026-10-24', ResultOnPage: '30' });
});

test('newJobs returns nothing without a key', async (t) => {
  delete process.env.JOOBLE_API_KEY;
  const fetchMock = t.mock.method(globalThis, 'fetch', upstream);
  assert.deepEqual(await newJobs('', 14.55, 121.02), { city: null, jobs: [] });
  assert.equal(fetchMock.mock.callCount(), 0);
});
