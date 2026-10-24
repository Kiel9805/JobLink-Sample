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
        properties: { query: { type: 'STRING' }, why: { type: 'STRING' } },
        required: ['query', 'why'],
      },
    },
  },
  required: ['titles', 'skills', 'industries', 'searchQueries'],
};

const prompt = `You are helping a job seeker in the Philippines. Read the attached resume and return:
- titles: job titles that fit them
- skills: their key skills
- industries: industries that fit them
- searchQueries: 3 to 5 Google Maps place searches for kinds of companies that would hire them, each with a one-line "why" addressed to the job seeker.
Each query must be a kind of business Google Maps can find as a place (e.g. "software company", "BPO company", "bank", "hospital"), never a job title.`;

const isStrings = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string');
const isQuery = (q) => q && typeof q.query === 'string' && q.query.trim() && typeof q.why === 'string';

// Throws without echoing the model output: it is derived from the resume.
export function validateProfile(p) {
  if (!p || !isStrings(p.titles) || !isStrings(p.skills) || !isStrings(p.industries) ||
      !Array.isArray(p.searchQueries) || !p.searchQueries.length || !p.searchQueries.every(isQuery)) {
    throw new Error('Gemini returned an unexpected profile shape');
  }
  const { titles, skills, industries } = p;
  return { titles, skills, industries, searchQueries: p.searchQueries.slice(0, 5).map(({ query, why }) => ({ query, why })) };
}

export async function extractProfile(pdfBase64) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
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
