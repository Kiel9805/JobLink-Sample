import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProfile, validateProfile } from './gemini.js';

const good = {
  titles: ['Developer'], skills: ['Python'], industries: ['Fintech'],
  searchQueries: Array.from({ length: 7 }, (_, i) => ({ query: `q${i}`, why: 'fits' })),
};
const reply = (text, ok = true) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: ok ? 200 : 500 });

test('validateProfile caps queries at 5', () => {
  assert.equal(validateProfile(good).searchQueries.length, 5);
});

test('validateProfile rejects bad shapes', () => {
  for (const bad of [null, {}, { ...good, titles: 'x' }, { ...good, searchQueries: [] }, { ...good, searchQueries: [{ query: '', why: 'x' }] }, { ...good, skills: [1] }]) {
    assert.throws(() => validateProfile(bad), /unexpected profile shape/);
  }
});

test('extractProfile sends the PDF inline with a JSON schema and parses the reply', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', reply(JSON.stringify(good)));
  const profile = await extractProfile('JVBERg==');
  assert.deepEqual(profile.titles, ['Developer']);
  const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'application/pdf');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('extractProfile throws on non-JSON or failed replies', async (t) => {
  t.mock.method(globalThis, 'fetch', reply('not json'));
  await assert.rejects(extractProfile('JVBERg=='), /unexpected profile shape/);
  t.mock.method(globalThis, 'fetch', reply('{}', false));
  await assert.rejects(extractProfile('JVBERg=='), /Gemini request failed \(500\)/);
});
