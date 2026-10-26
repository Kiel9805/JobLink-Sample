import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRss, latestNews, resetNews, JOB_HEADLINE, FEEDS } from './news.js';
import { pool } from './db.js';

beforeEach(resetNews);

const rss = (...items) => `<?xml version="1.0"?><rss><channel><title>Feed</title>${items.map(([title, link, date]) =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Body</p>]]></description></item>`).join('')}</channel></rss>`;

test('parseRss reads CDATA titles, decodes entities, converts dates and drops non-http links', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Firm &amp; partner hiring 500 in Cebu]]></title><link>https://example.ph/a</link><pubDate>Mon, 26 Oct 2026 13:23:00 +0800</pubDate></item>
    <item><title>DOLE&#8217;s job fair &quot;draws&quot; 2,000</title><link>https://example.ph/b</link><pubDate>not a date</pubDate></item>
    <item><title>Bad link</title><link>javascript:alert(1)</link></item>
  </channel></rss>`;
  assert.deepEqual(parseRss(xml, 'Test'), [
    { title: 'Firm & partner hiring 500 in Cebu', link: 'https://example.ph/a', source: 'Test', published: '2026-10-26T05:23:00.000Z' },
    { title: 'DOLE’s job fair "draws" 2,000', link: 'https://example.ph/b', source: 'Test', published: null },
  ]);
});

test('JOB_HEADLINE keeps job stories and skips general business news', () => {
  for (const t of ['BPO firm hiring 1,000 agents', 'DOLE job fair in Davao', 'Unemployment rate eases', 'Amex cutting 5% of global workforce']) assert.ok(JOB_HEADLINE.test(t), t);
  for (const t of ['Landbank backs solar projects with P11.7B loan', 'Gov’t expands solar irrigation', 'MREIT profit doubles']) assert.ok(!JOB_HEADLINE.test(t), t);
});

test('latestNews keeps job headlines, newest first, survives a broken feed, and re-reads feeds at most every 30 minutes', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === FEEDS[0][1]) return new Response(rss(
      ['Solar loan approved', 'https://example.ph/solar', 'Mon, 26 Oct 2026 08:00:00 +0800'],
      ['BPO firm hiring 1,000 in Makati', 'https://example.ph/bpo', 'Mon, 26 Oct 2026 09:00:00 +0800'],
    ));
    if (url === FEEDS[1][1]) return new Response(rss(['Job fair this Friday', 'https://example.ph/fair', 'Tue, 27 Oct 2026 07:00:00 +0800']));
    if (url === FEEDS[2][1]) return new Response('', { status: 503 });
    return new Response(rss());
  });
  t.mock.method(console, 'error', () => {});
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-27T12:00:00Z') });

  const news = await latestNews(null);
  assert.deepEqual(news.map((n) => n.title), ['Job fair this Friday', 'BPO firm hiring 1,000 in Makati']);
  assert.equal(news[1].source, FEEDS[0][0]);
  const calls = fetchMock.mock.callCount();
  assert.equal(calls, FEEDS.length);

  await latestNews(null);
  assert.equal(fetchMock.mock.callCount(), calls); // within 30 minutes: no new fetches
  t.mock.timers.tick(31 * 60 * 1000);
  await latestNews(null);
  assert.equal(fetchMock.mock.callCount(), calls * 2);
});

test('Postgres news round-trip', { skip: !process.env.DATABASE_URL && 'DATABASE_URL is not set' }, async (t) => {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const link = `https://example.test/joblink-news-${Date.now()}`;
  t.after(async () => { await pool.query('DELETE FROM news_items WHERE link = $1', [link]); await pool.end(); });
  const fresh = new Date().toUTCString();
  t.mock.method(globalThis, 'fetch', async (url) => new Response(url === FEEDS[0][1] ? rss(['Test company hiring 50', link, fresh]) : rss()));
  const news = await latestNews();
  assert.ok(news.some((n) => n.link === link && n.title === 'Test company hiring 50'));
});
