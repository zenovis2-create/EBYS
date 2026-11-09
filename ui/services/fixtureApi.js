// SAMPLE (fixture) API — SYNTHETIC / SIMULATED. It emits the same shapes as the live core/server
// (object when.value + object candidates, who as [{name}], answers with memoryId, nested preview with
// modeLabel/warnings, records with readbackText) so screens are exercised against the real contract.
// It is NOT an AI: it can only "read" the built-in sample texts, answers a few questions by keyword,
// and simulates the action service. It is never evidence that the model route works; the UI labels it.
//
// Test-only fault injection: ?fault=failed|permission_denied|unknown_outcome|handed_off|real_ok

import { SAMPLES } from '../samples.js';
import { canonicalJsonLocal } from '../lib/canon.js';

const DEMO_NOW = '2026-11-09T10:30:00+09:00';
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(new Error('cancelled')); }, { once: true });
});

function digest(obj) {
  const s = canonicalJsonLocal(obj);
  let hsh = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) >>> 0; }
  return `fx-${hsh.toString(16)}`;
}

export function parseUtterances(sessionId, text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const m = /^([^:：]{1,30})[:：]\s*(.+)$/.exec(line);
    const label = m ? m[1].trim() : 'Unknown';
    const body = m ? m[2].trim() : line;
    const known = Boolean(m) && !/^(모르는 사람|알 수 없는 사람|unknown)/i.test(label);
    return {
      id: `${sessionId}-u${i + 1}`, sessionId, speakerId: `${sessionId}-s-${label}`, speakerLabel: label,
      speakerKnown: known, text: body, startedAt: DEMO_NOW, lang: /[가-힣]/.test(body) ? 'ko' : 'en', provenance: 'synthetic',
    };
  });
}

const unknownSlot = (clarification) => ({ state: 'unknown', uncertainty: 'unknown', evidence: [], value: null, ...(clarification ? { clarification } : {}) });
function ev(utts, idx, quote) {
  const u = utts[idx];
  const charStart = u.text.indexOf(quote);
  if (charStart < 0) throw new Error(`fixture quote not found: ${quote}`);
  return { utteranceId: u.id, charStart, charEnd: charStart + quote.length, quote };
}
// Core-shaped slots
const whoS = (name, unc, evs) => ({ state: 'known', value: [{ name }], display: name, uncertainty: unc, evidence: evs });
const whereS = (name, unc, evs) => ({ state: 'known', value: { name }, display: name, uncertainty: unc, evidence: evs });
const whatS = (en, ko, unc, evs) => ({ state: 'known', value: { text: en, title: { en, ko } }, display: en, uncertainty: unc, evidence: evs });
const whenKnown = (date, time, en, ko, unc, evs) => ({
  state: 'known', value: { date, time, startIso: `${date}T${time}:00+09:00`, tz: 'Asia/Seoul', displayEn: en, displayKo: ko }, display: en, uncertainty: unc, evidence: evs,
});
const cand = (date, time, en, ko) => ({ date, time, startIso: `${date}T${time}:00+09:00`, labelEn: en, labelKo: ko });
const whenAmbiguous = (date, en, ko, candidates, evs) => ({
  state: 'ambiguous', value: { date, time: null, startIso: null, tz: 'Asia/Seoul', displayEn: en, displayKo: ko }, display: en, uncertainty: 'ambiguous',
  candidates, clarification: { ko: '오전인가요, 오후인가요?', en: 'Is that AM or PM?' }, evidence: evs,
});

function buildClinicEn(sid, u) {
  const m1 = `${sid}-m1`; const m2 = `${sid}-m2`; const m3 = `${sid}-m3`;
  return [
    {
      id: m1, lang: 'en', kind: 'event', summary: { ko: '하버 클리닉 건강검진 · 금요일 오전 10시', en: 'Checkup at Harbor Clinic · Friday 10 AM' },
      who: whoS('Harbor Clinic', 'stated', [ev(u, 0, 'Harbor Clinic')]),
      when: whenKnown('2026-11-13', '10:00', 'Fri, Nov 13, 10:00 AM', '11월 13일 금요일 오전 10:00', 'superseded', [ev(u, 0, 'Friday at 10 in the morning'), ev(u, 2, 'Friday does not work anymore')]),
      where: whereS('Harbor Clinic', 'stated', [ev(u, 0, 'Harbor Clinic')]),
      what: whatS('Checkup', '건강검진', 'stated', [ev(u, 0, 'checkup')]),
      status: 'superseded', supersededBy: m2, evidence: [ev(u, 0, 'Friday at 10 in the morning'), ev(u, 2, 'Friday does not work anymore')], provenance: 'synthetic', revision: 1,
    },
    {
      id: m2, lang: 'en', kind: 'event', summary: { ko: '딸과 하버 클리닉 건강검진 · 목요일 3시쯤', en: 'Checkup at Harbor Clinic with your daughter · Thursday around 3' },
      who: whoS('Daughter', 'stated', [ev(u, 2, 'I will take you')]),
      when: whenAmbiguous('2026-11-12', 'Thu, Nov 12, around 3 (AM or PM?)', '11월 12일 목요일 3시쯤 (오전/오후?)',
        [cand('2026-11-12', '03:00', 'Thu, Nov 12, 3:00 AM', '11월 12일 (목) 오전 3:00'), cand('2026-11-12', '15:00', 'Thu, Nov 12, 3:00 PM', '11월 12일 (목) 오후 3:00')],
        [ev(u, 2, 'on Thursday'), ev(u, 2, 'Around 3?'), ev(u, 3, 'Thursday is fine')]),
      where: whereS('Harbor Clinic', 'inferred', [ev(u, 0, 'Harbor Clinic')]),
      what: whatS('Checkup', '건강검진', 'inferred', [ev(u, 0, 'checkup')]),
      status: 'candidate', supersedes: [m1], evidence: [ev(u, 2, 'on Thursday'), ev(u, 2, 'Around 3?'), ev(u, 3, 'Thursday is fine')], provenance: 'synthetic', revision: 1,
    },
    {
      id: m3, lang: 'en', kind: 'task', summary: { ko: '약은 식후에 (말한 사람 모름 · 확인 안 됨)', en: 'Take the medicine after meals (unknown speaker · unconfirmed)' },
      who: unknownSlot(), when: unknownSlot(), where: unknownSlot(),
      what: whatS('Take the medicine after meals', '약은 식후에 먹기', 'stated', [ev(u, 4, 'Take the medicine after meals')]),
      status: 'candidate', evidence: [ev(u, 4, 'Take the medicine after meals')], provenance: 'synthetic', revision: 1,
    },
  ];
}

function buildLibrary(sid, u) {
  const m1 = `${sid}-m1`; const m2 = `${sid}-m2`; const m3 = `${sid}-m3`;
  return [
    {
      id: m1, lang: 'en', kind: 'event', summary: { ko: '도서관 만남 · 화요일 2시', en: 'Library meetup · Tuesday at two' },
      who: whoS('Dana', 'stated', [ev(u, 0, 'Can you meet me')]),
      when: whenAmbiguous('2026-11-10', 'Tue, Nov 10, at two', '11월 10일 화요일 2시', [], [ev(u, 0, 'Tuesday at two'), ev(u, 1, 'Tuesday is my physio day')]),
      where: whereS('the library', 'stated', [ev(u, 0, 'the library')]),
      what: whatS('Meet Dana', 'Dana 만나기', 'stated', [ev(u, 0, 'meet me')]),
      status: 'superseded', supersededBy: m2, evidence: [ev(u, 0, 'Tuesday at two'), ev(u, 1, 'Tuesday is my physio day')], provenance: 'synthetic', revision: 1,
    },
    {
      id: m2, lang: 'en', kind: 'event', summary: { ko: 'Dana와 도서관 만남 · 수요일 2시', en: 'Meet Dana at the library · Wednesday at two' },
      who: whoS('Dana', 'stated', [ev(u, 2, 'Wednesday then')]),
      when: whenAmbiguous('2026-11-11', 'Wed, Nov 11, at two (AM or PM?)', '11월 11일 수요일 2시 (오전/오후?)',
        [cand('2026-11-11', '02:00', 'Wed, Nov 11, 2:00 AM', '11월 11일 (수) 오전 2:00'), cand('2026-11-11', '14:00', 'Wed, Nov 11, 2:00 PM', '11월 11일 (수) 오후 2:00')],
        [ev(u, 2, 'Wednesday then'), ev(u, 3, 'Wednesday at two')]),
      where: whereS('the library', 'inferred', [ev(u, 2, 'Same place?')]),
      what: whatS('Meet Dana', 'Dana 만나기', 'inferred', [ev(u, 3, 'Wednesday at two, yes')]),
      status: 'candidate', supersedes: [m1], evidence: [ev(u, 2, 'Wednesday then'), ev(u, 3, 'Wednesday at two')], provenance: 'synthetic', revision: 1,
    },
    {
      id: m3, lang: 'en', kind: 'task', summary: { ko: '책 가져가기 (Sam)', en: 'Bring the book (Sam)' },
      who: whoS('Sam', 'stated', [ev(u, 3, 'I will bring the book')]), when: unknownSlot(), where: unknownSlot(),
      what: whatS('Bring the book', '책 가져가기', 'stated', [ev(u, 3, 'bring the book')]),
      status: 'candidate', evidence: [ev(u, 3, 'bring the book')], provenance: 'synthetic', revision: 1,
    },
  ];
}

function buildClinicKo(sid, u) {
  const m1 = `${sid}-m1`; const m2 = `${sid}-m2`; const m3 = `${sid}-m3`;
  return [
    {
      id: m1, lang: 'ko', kind: 'event', summary: { ko: '건강검진 · 금요일 오전 10시 (한울내과)', en: 'Checkup · Friday 10 AM (Haneul Clinic)' },
      who: whoS('한울내과', 'stated', [ev(u, 0, '한울내과')]),
      when: whenKnown('2026-11-13', '10:00', 'Fri, Nov 13, 10:00 AM', '11월 13일 금요일 오전 10:00', 'superseded', [ev(u, 0, '금요일 오전 10시'), ev(u, 2, '금요일은 이제 안 돼요')]),
      where: whereS('한울내과', 'stated', [ev(u, 0, '한울내과')]),
      what: whatS('Checkup', '건강검진', 'stated', [ev(u, 0, '건강검진')]),
      status: 'superseded', supersededBy: m2, evidence: [ev(u, 0, '금요일 오전 10시'), ev(u, 2, '금요일은 이제 안 돼요')], provenance: 'synthetic', revision: 1,
    },
    {
      id: m2, lang: 'ko', kind: 'event', summary: { ko: '딸과 건강검진 · 목요일 3시쯤', en: 'Checkup with your daughter · Thursday around 3' },
      who: whoS('딸', 'stated', [ev(u, 2, '제가 목요일에 모시고 갈게요')]),
      when: whenAmbiguous('2026-11-12', 'Thu, Nov 12, around 3 (AM or PM?)', '11월 12일 목요일 3시쯤 (오전/오후?)',
        [cand('2026-11-12', '03:00', 'Thu, Nov 12, 3:00 AM', '11월 12일 (목) 오전 3:00'), cand('2026-11-12', '15:00', 'Thu, Nov 12, 3:00 PM', '11월 12일 (목) 오후 3:00')],
        [ev(u, 2, '목요일에'), ev(u, 2, '3시쯤'), ev(u, 3, '목요일 좋다')]),
      where: whereS('한울내과', 'inferred', [ev(u, 0, '한울내과')]),
      what: whatS('Checkup', '건강검진', 'inferred', [ev(u, 0, '건강검진')]),
      status: 'candidate', supersedes: [m1], evidence: [ev(u, 2, '목요일에'), ev(u, 2, '3시쯤'), ev(u, 3, '목요일 좋다')], provenance: 'synthetic', revision: 1,
    },
    {
      id: m3, lang: 'ko', kind: 'task', summary: { ko: '약은 식후에 (말한 사람 모름 · 확인 안 됨)', en: 'Medicine after meals (unknown speaker · unconfirmed)' },
      who: unknownSlot(), when: unknownSlot(), where: unknownSlot(),
      what: whatS('Take the medicine after meals', '약은 식후에 먹기', 'stated', [ev(u, 4, '약은 식후에 드세요')]),
      status: 'candidate', evidence: [ev(u, 4, '약은 식후에 드세요')], provenance: 'synthetic', revision: 1,
    },
  ];
}

const BUILDERS = new Map([[SAMPLES.sample1, buildClinicEn], [SAMPLES.sample2, buildLibrary], [SAMPLES.sample3, buildClinicKo]]);

export function createFixtureApi({ fault = null, latency = 1 } = {}) {
  let seq = 0;
  let sessions = []; // { id, title, utterances }
  let memories = [];
  const proposals = new Map();
  const records = new Map(); // `${proposalId}:${revision}` -> record

  const L = (ms) => Math.round(ms * latency);

  function recomputeProposal(p) {
    const f = p.fields;
    const missing = [];
    if (f.kind === 'appointment' && !f.startsAt) missing.push('when.time');
    p.missing = missing;
    if (p.state !== 'cancelled' && p.state !== 'user_confirmed') p.state = missing.length ? 'needs_info' : 'proposed';
    const when = f.startsAt ? f.startsAt.replace('T', ' ').slice(0, 16) : null;
    p.readback = {
      ko: `${f.title} · ${f.who ?? '상대 모름'} · ${when ?? '시간 모름'} · ${f.where ?? '장소 모름'}`,
      en: `${f.title} · ${f.who ?? 'person unknown'} · ${when ?? 'time unknown'} · ${f.where ?? 'place unknown'}`,
    };
    return p;
  }

  const ok = (data) => ({ ok: true, data: structuredClone(data) });
  const bad = (code, message, extra = {}) => ({ ok: false, error: { code, message, retryable: false, ...extra } });
  const fieldsOf = (p) => ({
    kind: p.fields.kind, title: p.fields.title, who: p.fields.who ?? null, startsAt: p.fields.startsAt ?? null,
    where: p.fields.where ?? null, reminders: p.fields.remindOffsetsMin, tz: 'Asia/Seoul',
  });
  const MODE_LABEL = { en: 'Simulation only: nothing will be saved to your phone or calendar', ko: '시뮬레이션: 휴대폰에는 저장되지 않습니다' };

  return {
    kind: 'fixture',

    async ingest({ title, text, provenance }, { signal } = {}) {
      await wait(L(1400), signal);
      const norm = (s) => s.replace(/\r/g, '').trim();
      const sample = Object.values(SAMPLES).find((s) => norm(s.text) === norm(text));
      seq += 1;
      const sid = `fx${seq}`;
      const utterances = parseUtterances(sid, text);
      sessions.push({ id: sid, title: title || sample?.title || 'untitled', utterances });
      const created = sample ? BUILDERS.get(sample)(sid, utterances) : [];
      memories.push(...created);
      return ok({
        sessionId: sid, utterances, memoriesCreated: created.length, rejected: 0,
        route: { id: 'fixture', model: 'none', cached: false }, mode: 'fixture',
        note: sample ? undefined : 'fixture cannot read new text', provenance,
      });
    },

    async memories() { return ok(memories); },

    async query({ text }, { signal } = {}) {
      await wait(L(900), signal);
      const active = memories.filter((m) => m.status === 'candidate');
      const asksMed = /medicine|pill|약/i.test(text);
      const asksEvent = /병원|누구|언제|어디|도서관|만나|when|who|where|clinic|doctor|library|meet|appointment|checkup/i.test(text);
      const m = asksMed ? active.find((x) => x.kind === 'task' && x.who.state === 'unknown') : asksEvent ? active.find((x) => x.kind === 'event') : null;
      if (!m) {
        return ok({
          found: false, sentence: { ko: '대화에서 찾지 못했어요.', en: "I couldn't find that in the conversation." },
          slots: { who: unknownSlot(), when: unknownSlot(), where: unknownSlot(), what: unknownSlot() }, caveats: [], matches: [],
          notFoundReason: 'not_in_memory', mode: 'fixture', route: { id: 'fixture', model: 'none', cached: false },
        });
      }
      const caveats = [];
      if (m.evidence.every((e) => sessions.flatMap((s) => s.utterances).find((x) => x.id === e.utteranceId)?.speakerKnown === false)) caveats.push('speaker_unknown');
      caveats.push('unconfirmed');
      if (m.when.state === 'ambiguous') caveats.push('time_ambiguous');
      const ans = {
        found: true, mode: 'fixture', route: { id: 'fixture', model: 'none', cached: false }, memoryId: m.id, caveats,
        sentence: m.kind === 'event'
          ? { ko: `${m.summary.ko}. 시간은 아직 확정되지 않았어요.`, en: `${m.summary.en}. The time is not settled yet.` }
          : { ko: `${m.summary.ko}.`, en: `${m.summary.en}.` },
        slots: { who: m.who, when: m.when, where: m.where, what: m.what },
      };
      if (m.when.state === 'ambiguous') {
        ans.clarification = {
          slot: 'when', prompt: m.when.clarification,
          options: (m.when.candidates ?? []).map((c) => ({ label: c.labelKo, labelEn: c.labelEn, value: { date: c.date, time: c.time, startIso: c.startIso } })),
          allowFreeInput: true, allowUnknown: true,
        };
      }
      return ok(ans);
    },

    _propose(memoryId) {
      const existing = [...proposals.values()].find((p) => p.fields.sourceMemoryIds.includes(memoryId) && p.state !== 'cancelled');
      if (existing) return existing;
      const m = memories.find((x) => x.id === memoryId);
      if (!m) return null;
      seq += 1;
      const isEvent = m.kind === 'event';
      const lang = m.lang ?? 'en';
      const p = recomputeProposal({
        id: `fxp${seq}`, revision: 1, state: 'proposed', missing: [],
        slotUncertainty: { who: m.who?.uncertainty, when: m.when?.uncertainty ?? 'unknown', where: m.where?.uncertainty, what: m.what?.uncertainty },
        evidence: m.evidence,
        fields: {
          kind: isEvent ? 'appointment' : 'todo', title: m.what?.value?.title?.[lang] ?? m.summary[lang],
          who: m.who?.value?.[0]?.name, where: m.where?.value?.name,
          startsAt: m.when?.state === 'known' ? m.when.value?.startIso ?? undefined : undefined,
          remindOffsetsMin: isEvent ? [60] : [], sourceMemoryIds: [m.id],
        },
      });
      proposals.set(p.id, p);
      return p;
    },

    async propose({ memoryId }, { signal } = {}) {
      await wait(L(500), signal);
      const m = memories.find((x) => x.id === memoryId);
      if (m && m.status === 'superseded') return bad('memory_not_active', 'memory is superseded; cannot propose');
      const p = this._propose(memoryId);
      return p ? ok(p) : bad('not_found', 'memory not found');
    },

    async updateProposal(id, patch, { signal } = {}) {
      await wait(L(300), signal);
      const p = proposals.get(id);
      if (!p) return bad('not_found', 'proposal not found');
      if (p.state === 'cancelled' || p.state === 'user_confirmed') return bad('proposal_closed', `proposal is ${p.state}`);
      p.fields = { ...p.fields, ...patch };
      if (patch.startsAt) p.slotUncertainty.when = 'stated';
      p.revision += 1;
      recomputeProposal(p);
      return ok(p);
    },

    async cancelProposal(id, { signal } = {}) {
      await wait(L(200), signal);
      const p = proposals.get(id);
      if (!p) return bad('not_found', 'proposal not found');
      if (p.state !== 'user_confirmed') p.state = 'cancelled';
      return ok(p);
    },

    async preview({ proposalId }, { signal } = {}) {
      await wait(L(500), signal);
      const p = proposals.get(proposalId);
      if (!p) return bad('not_found', 'proposal not found');
      if (p.state === 'cancelled') return bad('proposal_closed', 'proposal is cancelled');
      if (p.missing.length) {
        return ok({ proposalId, revision: p.revision, needs_clarification: { needs_clarification: true, missing: p.missing, prompt: { ko: '오전인지 오후인지 골라 주세요.', en: 'Please choose the time, including AM or PM.' } } });
      }
      const fields = fieldsOf(p);
      const warnings = [];
      if (!fields.where) warnings.push({ code: 'place_unknown', message: { ko: '장소가 정해지지 않았습니다.', en: 'No place has been set.' } });
      if (!fields.who) warnings.push({ code: 'person_unknown', message: { ko: '상대가 정해지지 않았습니다.', en: 'No person has been set.' } });
      const previewDigest = digest(fields);
      const preview = { needs_clarification: false, kind: fields.kind, adapterId: 'fixture-sim', mode: 'simulated', previewDigest, fields, modeLabel: MODE_LABEL, warnings };
      return ok({ proposalId, revision: p.revision, preview, previewDigest, mode: 'simulated', adapterId: 'fixture-sim' });
    },

    async confirm({ proposalId, previewDigest }, { signal } = {}) {
      await wait(L(900), signal);
      const p = proposals.get(proposalId);
      if (!p) return bad('not_found', 'proposal not found');
      if (p.state === 'cancelled') return bad('proposal_closed', 'proposal was cancelled');
      const key = `${p.id}:${p.revision}`;
      if (records.has(key)) return ok(records.get(key)); // idempotent
      const fields = fieldsOf(p);
      if (digest(fields) !== previewDigest) return bad('stale_preview', 'preview changed; review again');
      const base = {
        recordId: `fxr${key}`, intentId: p.id, revision: p.revision, adapterId: 'fixture-sim', mode: 'simulated', preview: { fields },
        timestamps: { confirmedAt: DEMO_NOW }, verifyLevel: 'none',
      };
      let rec;
      if (fault === 'failed') {
        rec = { ...base, status: 'failed', error: { code: 'api_500', phase: 'pre_send', message: 'simulated failure', retryable: true, userHint: { ko: '저장하지 못했어요. 다시 시도할 수 있어요.', en: 'It was not saved. You can try again.' } } };
      } else if (fault === 'permission_denied') {
        rec = { ...base, status: 'permission_denied', error: { code: 'permission_denied', phase: 'pre_send', message: 'calendar permission denied', retryable: true, userHint: { ko: '캘린더 접근을 허용해 주세요.', en: 'Please allow calendar access.' } } };
      } else if (fault === 'unknown_outcome') {
        rec = { ...base, status: 'unknown_outcome', error: { code: 'lost_response', phase: 'post_send', message: 'no response after send', retryable: false } };
      } else if (fault === 'handed_off') {
        rec = { ...base, status: 'handed_off', verifyLevel: 'handoff', adapterId: 'ics-export' };
      } else if (fault === 'real_ok') {
        rec = { ...base, status: 'completed', mode: 'real', verifyLevel: 'api_readback', adapterId: 'TEST-ONLY', readback: { title: fields.title, startsAt: fields.startsAt, where: fields.where, who: fields.who, reminders: fields.reminders }, timestamps: { confirmedAt: DEMO_NOW, verifiedAt: DEMO_NOW } };
      } else {
        rec = { ...base, status: 'completed', mode: 'simulated', verifyLevel: 'none' };
      }
      rec.readbackText = rec.status === 'completed' && rec.mode === 'simulated'
        ? { en: 'Simulation only: nothing was saved to a real calendar.', ko: '시뮬레이션이에요. 실제 캘린더에는 저장되지 않았어요.' }
        : undefined;
      if (rec.status !== 'failed' && rec.status !== 'permission_denied') {
        p.state = 'user_confirmed'; p.actionRecordId = rec.recordId; records.set(key, rec);
      }
      return ok(rec);
    },

    async remove({ sessionId, all }, { signal } = {}) {
      await wait(L(600), signal);
      const scope = all ? 'all' : 'session';
      if (all) { sessions = []; memories = []; proposals.clear(); records.clear(); }
      else {
        sessions = sessions.filter((s) => s.id !== sessionId);
        const gone = new Set(memories.filter((m) => m.id.startsWith(`${sessionId}-`)).map((m) => m.id));
        memories = memories.filter((m) => !gone.has(m.id));
        for (const [id, p] of proposals) if (p.fields.sourceMemoryIds.some((x) => gone.has(x))) proposals.delete(id);
      }
      const stores = [
        ['transcript', 'verified_deleted'], ['memories', 'verified_deleted'], ['search_index', 'verified_deleted'],
        ['proposals', 'verified_deleted'], ['action_ledger', 'verified_deleted'], ['notification_queue', 'not_applicable'],
        ['llm_cache', 'not_applicable'], ['exported_file', 'not_verified'], ['external_calendar', 'not_applicable'],
      ].map(([name, status]) => ({ name, status, ...(name === 'exported_file' ? { detail: 'outside app' } : {}) }));
      return ok({ scope, at: DEMO_NOW, stores, allVerified: false });
    },

    async runtime() {
      return ok({
        data: 'synthetic', calendar: { kind: 'simulated', name: 'fixture-sim', permission: 'n/a' }, notifications: { kind: 'simulated', permission: 'n/a' },
        micCapture: 'unavailable', speechInput: 'unavailable', version: `ui-fixture${fault ? ` (fault=${fault})` : ''}`,
        model: { route: 'fixture', model: 'none', healthy: null },
      });
    },
  };
}
