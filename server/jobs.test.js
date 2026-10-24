import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { findJobs } from './jobs.js';
import { throttle } from './places.js';

throttle.gapMs = 0;
beforeEach(() => { process.env.JOOBLE_API_KEY = 'secret-jooble-key'; });

const joobleJobs = [
  { id: 7, title: 'Full Stack <b>Developer</b>', company: 'Acme &amp; Co', location: 'Makati', salary: '₱60k', snippet: '&nbsp;Build <b>React</b> apps', link: 'https://jooble.org/desc/7' },
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
  assert.deepEqual(jobs, [{ id: 'https://jooble.org/desc/7', title: 'Full Stack Developer', company: 'Acme & Co', location: 'Makati', salary: '₱60k', snippet: 'Build React apps', link: 'https://jooble.org/desc/7' }]);
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
