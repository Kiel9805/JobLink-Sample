import { pool } from './db.js';

// Philippine news RSS feeds that worked when checked (Manila Bulletin blocks bots; PNA has no feed).
export const FEEDS = [
  ['Manila Times', 'https://www.manilatimes.net/news/feed/'],
  ['Manila Times', 'https://www.manilatimes.net/business/feed/'],
  ['BusinessWorld', 'https://www.bworldonline.com/feed/'],
  ['Inquirer', 'https://business.inquirer.net/feed'],
  ['Inquirer', 'https://newsinfo.inquirer.net/feed'],
  ['Philstar', 'https://www.philstar.com/rss/business'],
  ['Philstar', 'https://www.philstar.com/rss/headlines'],
  ['GMA News', 'https://data.gmanetwork.com/gno/rss/money/feed.xml'],
  ['GMA News', 'https://data.gmanetwork.com/gno/rss/news/feed.xml'],
  ['Rappler', 'https://www.rappler.com/business/feed/'],
];

// Headlines (not summaries) must name jobs or hiring; summaries mention "jobs" in passing far too often.
export const JOB_HEADLINE = /\b(hiring|hires?|job ?fairs?|jobs?|vacanc(y|ies)|job ?seekers?|employ(ment|ees?|ers?)|unemploy\w*|workforce|manpower|layoffs?|career fairs?|internships?|BPO|IT-BPM)\b/i;

const REFRESH_MS = 30 * 60 * 1000;
const KEEP_DAYS = 30;
const MAX_ITEMS = 30;

const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

// shortcut: regex RSS parsing handles the flat RSS 2.0 these feeds use; switch to an XML parser if a feed breaks it.
export function parseRss(xml, source) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([item]) => {
    const tag = (name) => decode(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
    const published = Date.parse(tag('pubDate'));
    return { title: tag('title'), link: tag('link'), source, published: Number.isFinite(published) ? new Date(published).toISOString() : null };
  }).filter((n) => n.title && /^https?:\/\//.test(n.link));
}

async function fetchFeed([source, url]) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'JobLink/0.1 (https://github.com/Kiel9805/JobLink-Sample)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${source} feed failed (${res.status})`);
  return parseRss(await res.text(), source).filter((n) => JOB_HEADLINE.test(n.title));
}

let memory = []; // used when there is no database
let lastRefresh = 0;
let refreshing = null;

async function refresh(db) {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  for (const r of results) if (r.status === 'rejected') console.error(r.reason.message); // one broken feed must not hide the rest
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!db) {
    const byLink = new Map([...memory, ...items].map((n) => [n.link, n]));
    memory = [...byLink.values()];
    return;
  }
  for (const n of items) {
    await db.query(
      `INSERT INTO news_items (link, title, source, published_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (link) DO UPDATE SET title = EXCLUDED.title`,
      [n.link, n.title, n.source, n.published ?? new Date().toISOString()],
    );
  }
}

// Job-related headlines, newest first. Feeds are re-read at most every 30 minutes; headlines are kept 30 days,
// so the list builds up beyond what the feeds show at any one time.
export async function latestNews(db = pool) {
  if (Date.now() - lastRefresh > REFRESH_MS) {
    refreshing ??= refresh(db).catch((err) => console.error(`News refresh failed: ${err.message}`)).finally(() => {
      lastRefresh = Date.now();
      refreshing = null;
    });
    await refreshing;
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  if (!db) {
    return memory.filter((n) => (n.published ?? '') >= cutoff)
      .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '')).slice(0, MAX_ITEMS);
  }
  const { rows } = await db.query(
    `SELECT title, link, source, published_at FROM news_items WHERE published_at > $1 ORDER BY published_at DESC LIMIT ${MAX_ITEMS}`,
    [cutoff],
  );
  return rows.map((r) => ({ title: r.title, link: r.link, source: r.source, published: r.published_at.toISOString() }));
}

// For tests: forget the last refresh so the next call re-reads the feeds.
export function resetNews() {
  memory = [];
  lastRefresh = 0;
  refreshing = null;
}
