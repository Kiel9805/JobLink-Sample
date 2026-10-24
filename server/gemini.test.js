import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProfile, validateProfile } from './gemini.js';
import { TAGS } from './places.js';

const good = {
  titles: ['Developer'], skills: ['Python'], industries: ['Fintech'],
  searchQueries: Object.keys(TAGS).slice(0, 7).map((tag) => ({ tag, why: 'fits' })),
};
const reply = (text, ok = true) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: ok ? 200 : 500 });

test('validateProfile caps queries at 5', () => {
  assert.equal(validateProfile(good).searchQueries.length, 5);
});

test('validateProfile drops unknown and repeated tags', () => {
  const p = validateProfile({ ...good, searchQueries: [{ tag: 'office=it', why: 'a' }, { tag: 'office=it', why: 'b' }, { tag: 'shop=bakery', why: 'c' }] });
  assert.deepEqual(p.searchQueries, [{ tag: 'office=it', why: 'b' }]);
});

test('validateProfile rejects bad shapes', () => {
  for (const bad of [null, {}, { ...good, titles: 'x' }, { ...good, searchQueries: [] }, { ...good, searchQueries: [{ tag: 'shop=bakery', why: 'x' }] }, { ...good, skills: [1] }]) {
    assert.throws(() => validateProfile(bad), /unexpected profile shape/);
  }
});

test('extractProfile sends the PDF inline with a JSON schema limited to known tags', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', reply(JSON.stringify(good)));
  const profile = await extractProfile('JVBERg==');
  assert.deepEqual(profile.titles, ['Developer']);
  const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'application/pdf');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema.properties.searchQueries.items.properties.tag.enum, Object.keys(TAGS));
});

test('extractProfile throws on non-JSON or failed replies', async (t) => {
  t.mock.method(globalThis, 'fetch', reply('not json'));
  await assert.rejects(extractProfile('JVBERg=='), /unexpected profile shape/);
  t.mock.method(globalThis, 'fetch', reply('{}', false));
  await assert.rejects(extractProfile('JVBERg=='), /Gemini request failed \(500\)/);
});
