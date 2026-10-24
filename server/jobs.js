import { cityAt } from './places.js';

const MAX_JOBS = 20;

// Jooble snippets contain HTML; the page renders text only, so reduce them to plain text here.
const plain = (s = '') => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// Live openings for a job title near a point. Returns [] when JOOBLE_API_KEY is unset.
export async function findJobs(title, lat, lng) {
  const key = process.env.JOOBLE_API_KEY;
  if (!key || !title) return [];
  const city = await cityAt(lat, lng);
  // Jooble keys are per country: a key from jooble.org (US) gets 403 here; register at ph.jooble.org/api/about.
  const res = await fetch(`https://ph.jooble.org/api/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: title, location: city ?? '' }),
  });
  if (!res.ok) throw new Error(`Jooble request failed (${res.status})`); // never the URL: it contains the key
  const { jobs = [] } = await res.json();
  return jobs.filter((j) => j.title && j.link).slice(0, MAX_JOBS).map((j) => ({
    id: j.link, // Jooble's numeric ids exceed JS number precision, so they aren't unique once parsed
    title: plain(j.title),
    company: plain(j.company),
    location: plain(j.location),
    salary: plain(j.salary),
    snippet: plain(j.snippet),
    link: j.link,
  }));
}
