import { TAGS } from './places.js';

const strings = { type: 'ARRAY', items: { type: 'STRING' } };
const responseSchema = {
  type: 'OBJECT',
  properties: {
    titles: strings,
    skills: strings,
    industries: strings,
    searchQueries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { tag: { type: 'STRING', enum: Object.keys(TAGS) }, why: { type: 'STRING' } },
        required: ['tag', 'why'],
      },
    },
  },
  required: ['titles', 'skills', 'industries', 'searchQueries'],
};

const prompt = `You are helping a job seeker in the Philippines. Read the attached resume and return:
- titles: job titles that fit them
- skills: their key skills
- industries: industries that fit them
- searchQueries: 3 to 5 kinds of workplaces that would hire them, each as a "tag" picked from the list below, with a one-line "why" addressed to the job seeker.
Tags (tag: meaning):
${Object.entries(TAGS).map(([tag, label]) => `${tag}: ${label}`).join('\n')}`;

const isStrings = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string');
const isQuery = (q) => q && Object.hasOwn(TAGS, q.tag) && typeof q.why === 'string';

// Throws without echoing the model output: it is derived from the resume.
export function validateProfile(p) {
  if (!p || !isStrings(p.titles) || !isStrings(p.skills) || !isStrings(p.industries) || !Array.isArray(p.searchQueries)) {
    throw new Error('Gemini returned an unexpected profile shape');
  }
  // Drop unknown or repeated tags rather than failing the whole search.
  const byTag = new Map(p.searchQueries.filter(isQuery).map(({ tag, why }) => [tag, { tag, why }]));
  if (!byTag.size) throw new Error('Gemini returned an unexpected profile shape');
  const { titles, skills, industries } = p;
  return { titles, skills, industries, searchQueries: [...byTag.values()].slice(0, 5) };
}

export async function extractProfile(pdfBase64) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    }),
  });
  if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);
  const data = await res.json();
  let profile;
  try {
    profile = JSON.parse(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(''));
  } catch {
    throw new Error('Gemini returned an unexpected profile shape');
  }
  return validateProfile(profile);
}
