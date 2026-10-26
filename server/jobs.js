import { cityAt } from './places.js';

const MAX_JOBS = 20;
const NEW_JOB_DAYS = 3;

// Jooble snippets contain HTML; the page renders text only, so reduce them to plain text here.
const plain = (s = '') => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

async function jooble(body) {
  // Jooble keys are per country: a key from jooble.org (US) gets 403 here; register at ph.jooble.org/api/about.
  const res = await fetch(`https://ph.jooble.org/api/${encodeURIComponent(process.env.JOOBLE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jooble request failed (${res.status})`); // never the URL: it contains the key
  const { jobs = [] } = await res.json();
  return jobs.filter((j) => j.title && j.link).map((j) => {
    const posted = Date.parse(j.updated);
    return {
      id: j.link, // Jooble's numeric ids exceed JS number precision, so they aren't unique once parsed
      title: plain(j.title),
      company: plain(j.company),
      location: plain(j.location),
      salary: plain(j.salary),
      snippet: plain(j.snippet),
      link: j.link,
      posted: Number.isFinite(posted) ? new Date(posted).toISOString() : null,
    };
  });
}

// Live openings for a job title near a point. Returns [] when JOOBLE_API_KEY is unset.
export async function findJobs(title, lat, lng) {
  if (!process.env.JOOBLE_API_KEY || !title) return [];
  const city = await cityAt(lat, lng);
  return (await jooble({ keywords: title, location: city ?? '' })).slice(0, MAX_JOBS);
}

// Openings posted in the last few days near a point, newest first; title narrows them when the user has searched.
export async function newJobs(title, lat, lng) {
  if (!process.env.JOOBLE_API_KEY) return { city: null, jobs: [] };
  const city = await cityAt(lat, lng);
  const since = new Date(Date.now() - NEW_JOB_DAYS * 864e5).toISOString().slice(0, 10);
  const jobs = await jooble({ keywords: title ?? '', location: city ?? '', datecreatedfrom: since, ResultOnPage: '30' });
  jobs.sort((a, b) => (b.posted ?? '').localeCompare(a.posted ?? ''));
  return { city, jobs };
}
