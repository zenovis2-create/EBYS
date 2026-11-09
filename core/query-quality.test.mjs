// Query-quality regressions replayed from the real-model repro (evidence/lead-live-en-*.json), with a NEW synthetic text.
// (a) unanswerable kinds of question never return a neighbouring memory, (b) role-bound who, (c) what = the thing, not a person.
// A FAKE llm proves validation CODE only; it says nothing about model quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from './core.mjs';
import { fakeLlm, item, NOW } from './testkit.mjs';

const TEXT = [
  'Priya: Grandpa, the book club moved to the Oak Street cafe on Thursday at 2.',
  "Tom: Priya, it's Tom from the library, I'm calling about the book club.",
  "Martha: I'll bring a lemon cake to the book club.",
].join('\n');
const BC = { ko: '독서 모임', en: 'Book club' };
const extract = () => ({
  items: [
    item({ ref: 'm1', quote: 'the book club moved to the Oak Street cafe on Thursday at 2', u: 0, title: BC, who: [['Priya', 1, 'Priya'], ['Tom', 1, 'Tom from the library']], where: ['Oak Street cafe', 0], when: [[0, 'on Thursday at 2']], cue: 'replace' }),
    // the real model pointed the cake task at the event (target m1): a task must never be merged into an event
    { ...item({ ref: 'm2', kind: 'task', cue: 'none', quote: "I'll bring a lemon cake", u: 2, title: { ko: '레몬 케이크', en: 'Bring a lemon cake' }, what: ['a lemon cake', 2], target: 'm1' }), owner: 'other', confidence: 0.9 },
    item({ ref: 'm3', kind: 'person', cue: 'none', quote: 'it\'s Tom from the library', u: 1, title: { ko: '톰', en: 'Tom' }, who: [['Tom', 1, 'Tom from the library']] }),
    item({ ref: 'm4', kind: 'person', cue: 'none', quote: 'Martha', u: 2, title: { ko: '마사', en: 'Martha' }, who: [['Martha', 2, 'Martha']] }),
  ],
});

async function setup(query) {
  const core = createCore({ now: () => NOW, llm: fakeLlm({ extract, query }) });
  const r = await core.ingestText({ title: 'book club', text: TEXT });
  assert.equal(r.ok, true);
  const u = (await core.getTranscript(r.sessionId)).utterances;
  const mems = core.listMemories({ includeSuperseded: true });
  const by = (k) => mems.filter((m) => m.kind === k).map((m) => m.id);
  return { core, u, mems, by };
}

test('a task with a wrong target is not merged into an event (kind must match)', async () => {
  const { mems } = await setup(() => ({ found: false, memoryIds: [] }));
  assert.equal(mems.filter((m) => m.kind === 'event').length, 1);
  assert.equal(mems.filter((m) => m.kind === 'task').length, 1);
  const ev = mems.find((m) => m.kind === 'event');
  assert.ok(!(ev.who.display ?? '').includes('Martha'));
});

test('(a) unanswerable: bus route / how / price => found=false, "I don\'t have that", never the neighbouring memory', async () => {
  const t = { memories: null };
  const { core } = await setup((req, p) => {
    const mem = p.memories.find((m) => m.kind === 'event')?.id;
    if (p.question === 'MODEL SAYS NO') return { found: false, memoryIds: [mem], asked: ['other'], slots: {}, notFoundReason: 'no bus route in the conversations' };
    // a model that wrongly presents the neighbouring memory as the answer
    return { found: true, memoryIds: [mem], asked: [], slots: { where: { value: 'Oak Street cafe', quote: 'Oak Street cafe', utteranceId: p.utterances[0].id } } };
  });
  for (const q of ['What is the bus route to the cafe?', 'How much does the book club cost?', 'MODEL SAYS NO']) {
    const a = await core.query({ text: q });
    assert.equal(a.found, false, q);
    assert.equal(a.notFoundCode, 'not_in_memory', q);
    assert.equal(a.sentence.en, "I don't have that in your conversations.", q);
    assert.equal(a.memoryId, null, q);
    assert.deepEqual(a.matches, [], q);
    for (const k of ['who', 'when', 'where', 'what']) assert.equal(a.slots[k].state, 'unknown', `${q} ${k}`);
  }
  // Korean bus-route question too
  const ko = await core.query({ text: '카페까지 버스 노선이 어떻게 돼요?' });
  assert.equal(ko.found, false); assert.equal(ko.notFoundCode, 'not_in_memory');
  // a genuinely answerable question is NOT affected
  const ok = await core.query({ text: 'Where is the book club?' });
  assert.equal(ok.found, true); assert.equal(ok.slots.where.display, 'Oak Street cafe');
  void t;
});

test('(a) a route question IS answerable when an utterance states it (bound "other" slot with a verbatim quote)', async () => {
  const text = 'Priya: Take bus 42 to the Oak Street cafe.';
  const core = createCore({ now: () => NOW, llm: fakeLlm({ extract: () => ({ items: [] }), query: (r, p) => ({ found: true, memoryIds: [], asked: ['other'], slots: { other: { value: 'bus 42', quote: 'Take bus 42', utteranceId: p.utterances[0].id } } }) }) });
  await core.ingestText({ title: 'bus', text });
  const a = await core.query({ text: 'Which bus goes to the cafe?' });
  assert.equal(a.found, true); assert.equal(a.slots.what.display, 'bus 42'); assert.ok(a.slots.what.evidence.length);
  const bad = createCore({ now: () => NOW, llm: fakeLlm({ extract: () => ({ items: [] }), query: (r, p) => ({ found: true, memoryIds: [], asked: ['other'], slots: { other: { value: 'bus 99', quote: 'Take bus 42', utteranceId: p.utterances[0].id } } }) }) });
  await bad.ingestText({ title: 'bus', text });
  const b = await bad.query({ text: 'Which bus goes to the cafe?' });
  assert.equal(b.found, false);
});

test('(b) "who told us": a quote-bound speaker wins; without one the role is ambiguous, never "Tom, Martha"', async () => {
  const { core } = await setup((req, p) => {
    const ev = p.memories.find((m) => m.kind === 'event').id;
    const persons = p.memories.filter((m) => m.kind === 'person').map((m) => m.id);
    if (p.question.startsWith('BOUND')) return { found: true, memoryIds: [...persons, ev], asked: ['where', 'who'], slots: { who: { value: 'Priya', quote: 'Grandpa, the book club moved', utteranceId: p.utterances[0].id }, where: { value: 'Oak Street cafe', quote: 'Oak Street cafe', utteranceId: p.utterances[0].id } } };
    if (p.question.startsWith('UNBOUND')) return { found: true, memoryIds: [ev], asked: ['who'], slots: {} };
    // the model names a person that is only mentioned somewhere else: not the speaker, not in the quote => rejected, keep ambiguity
    return { found: true, memoryIds: [ev], asked: ['who'], slots: { who: { value: 'Martha', quote: 'Grandpa, the book club moved', utteranceId: p.utterances[0].id } } };
  });
  const a = await core.query({ text: 'BOUND Where is the book club now, and who told us?' });
  assert.equal(a.found, true);
  assert.equal(a.slots.who.display, 'Priya'); assert.equal(a.slots.who.state, 'known');
  assert.ok(a.slots.who.evidence.length); assert.equal(a.slots.where.display, 'Oak Street cafe');
  assert.ok(!/Martha/.test(a.sentence.en));
  assert.equal(a.memoryId, core.listMemories().find((m) => m.kind === 'event').id, 'event outranks person cards');

  for (const q of ['UNBOUND Who told us?', 'WRONG Who told us?']) {
    const b = await core.query({ text: q });
    assert.equal(b.slots.who.state, 'ambiguous', q);
    assert.ok(!/Martha/.test(b.slots.who.display), q);
    assert.equal(b.clarification.slot, 'who', q);
    assert.deepEqual(b.clarification.options.map((o) => o.labelEn).sort(), ['Priya', 'Tom'], q);
  }
});

test('(c) "who is bringing the cake": what is "a lemon cake" with its quote, who is the bound speaker', async () => {
  const { core, by } = await setup((req, p) => {
    const task = p.memories.find((m) => m.kind === 'task').id;
    const persons = p.memories.filter((m) => m.kind === 'person').map((m) => m.id);
    return { found: true, memoryIds: [...persons, task], asked: ['who'], slots: {
      who: { value: 'Martha', quote: "I'll bring a lemon cake", utteranceId: p.utterances[2].id },
      what: { value: 'a lemon cake', quote: 'a lemon cake', utteranceId: p.utterances[2].id },
    } };
  });
  const a = await core.query({ text: 'Who is bringing the cake?' });
  assert.equal(a.found, true);
  assert.equal(a.memoryId, by('task')[0], 'the task answers, not the person card');
  assert.equal(a.slots.who.display, 'Martha');
  assert.match(String(a.slots.what.display), /lemon cake/i);
  assert.notEqual(a.slots.what.display, 'Martha');
  assert.ok(a.slots.what.evidence.some((e) => /lemon cake/.test(e.quote)));
  // a person card alone has no "what"
  const pc = core.listMemories().find((m) => m.kind === 'person');
  assert.ok(pc);
});

test('fallback keyword query also refuses an unsupported question kind', async () => {
  const core = createCore({ now: () => NOW, llm: fakeLlm({ extract, query: () => ({ found: true, memoryIds: [] }), fail: 'timeout' }) });
  await core.ingestText({ title: 'book club', text: TEXT });
  const a = await core.query({ text: 'What is the bus route to the Oak Street cafe?' });
  assert.equal(a.found, false); assert.equal(a.mode, 'fallback');
  assert.equal(a.sentence.en, "I don't have that in your conversations.");
});
