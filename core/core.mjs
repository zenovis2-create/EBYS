// createCore({ now, store, llm }) - source-linked conversation memory (CONTRACTS.md section 4).
// Model does the understanding (extraction + free-form query). Code does: schema + verbatim-quote validation,
// date normalization, negation/supersede/dedup state machines, proposals, deletion with receipts.
import { readFileSync } from 'node:fs';
import { RECEIPT_STORES } from '../contracts/contracts.js';
import { createMemoryStore } from './store.mjs';
import { splitTranscript, sha, similarity, normName, detectLang } from './util.mjs';
import {
  buildExtractRequest, validateExtraction, buildQueryRequest, validateQuery,
  buildDigestRequest, validateDigest, buildClassifyRequest, validateClassify, locateQuote,
} from './schema.mjs';
import { fallbackExtract } from './fallback.mjs';
import {
  TZ, scanTimePhrases, parseTimePhrase, mergeParts, buildWhenSlot, seoulIso, seoulDateOf, seoulParts, weekdayOf, fmtDate, fmtTime, addDays, toIso,
} from './time.mjs';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const err = (code, message, extra = {}) => ({ ok: false, error: { code, message, retryable: false, ...extra } });
const ACTIVE = new Set(['candidate', 'user_confirmed']);
const AGREE_RANK = { none: 0, proposed: 1, agreed: 2 };
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export function createCore({ now = () => new Date(), store = createMemoryStore(), llm = null, purgers = [], llmTimeoutMs = 90000 } = {}) {
  const S = store.state;
  const nowIso = () => seoulIso(now());
  let chain = Promise.resolve();
  const locked = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  // ------------------------------------------------------------------ helpers
  const uttSession = (id) => S.utterances.get(id)?.sessionId;
  const evidenceKey = (e) => `${e.utteranceId}:${e.charStart}:${e.charEnd}`;
  const uniqEvidence = (list) => { const seen = new Set(); return list.filter((e) => { const k = evidenceKey(e); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const evRef = (loc, ids) => ({ utteranceId: ids[loc.utteranceIndex], charStart: loc.charStart, charEnd: loc.charEnd, quote: loc.quote });

  /** Re-verify an EvidenceRef against the store: quote === text.slice(start,end). */
  function evidenceOk(e) {
    const u = S.utterances.get(e?.utteranceId);
    return !!u && Number.isInteger(e.charStart) && Number.isInteger(e.charEnd) && u.text.slice(e.charStart, e.charEnd) === e.quote && e.quote.length > 0;
  }
  const verified = (list) => uniqEvidence((list ?? []).filter(evidenceOk));
  const unknownSlot = (clarification) => ({ state: 'unknown', uncertainty: 'unknown', evidence: [], value: null, ...(clarification ? { clarification } : {}) });
  const memText = (m) => [m.summary?.ko, m.summary?.en, m.who?.display, m.where?.display, m.what?.display, m.when?.value?.displayKo, m.when?.value?.displayEn].filter(Boolean).join(' ');
  const reindexMemory = (m) => { store.unindexDoc(`mem:${m.id}`); store.indexDoc(`mem:${m.id}`, memText(m)); };
  const isConstraint = (m) => m.meta?.constraint === 'unavailable';
  const statusFromHistory = (m) => {
    const last = m.meta.history[m.meta.history.length - 1];
    if (last) return last.type;
    return m.meta.confirmed ? 'user_confirmed' : 'candidate';
  };
  const memDates = (m) => new Set([m.when?.value?.date, ...(m.when?.candidates ?? []).map((c) => c.date)].filter(Boolean));
  const sessionLang = (m) => m.meta?.lang ?? 'en';
  const names = (slot) => (Array.isArray(slot?.value) ? slot.value.map((v) => v.name) : []);

  function slotsFromItem(item, ids, lang, anchor) {
    const ev = (e) => evRef(e, ids);
    const whoSlot = item.who.length
      ? { state: 'known', value: item.who.map((w) => ({ name: w.name })), display: item.who.map((w) => w.name).join(', '), uncertainty: item.confidence === 'stated' ? 'stated' : item.confidence, evidence: uniqEvidence(item.who.map((w) => ev(w.ev))) }
      : { ...unknownSlot({ ko: '누구인가요?', en: 'Who is it?' }) };
    const whereSlot = item.where
      ? { state: 'known', value: { name: item.where.name }, display: item.where.name, uncertainty: item.confidence === 'stated' ? 'stated' : item.confidence, evidence: [ev(item.where.ev)] }
      : { ...unknownSlot({ ko: '어디인가요?', en: 'Where is it?' }) };
    const whatText = item.what?.text ?? (lang === 'ko' ? item.title.ko : item.title.en);
    const whatEv = item.what ? [ev(item.what.ev)] : [ev(item.evidence[0])];
    const whatSlot = { state: 'known', value: { text: whatText, title: item.title }, display: whatText, uncertainty: item.confidence === 'stated' ? 'stated' : item.confidence, evidence: whatEv };
    const parts = []; const whenEv = [];
    for (const w of item.when) { const p = parseTimePhrase(w.ev.quote, anchor); if (p.matched) { parts.push(p); whenEv.push(ev(w.ev)); } }
    const whenSlot = parts.length
      ? buildWhenSlot(parts, { evidence: uniqEvidence(whenEv), confidence: item.confidence, lang })
      : unknownSlot({ ko: '언제인가요?', en: 'When is it?' });
    return { who: whoSlot, where: whereSlot, what: whatSlot, when: whenSlot, parts };
  }

  function refreshWhen(m) {
    const evs = m.when.evidence ?? [];
    const slot = m.meta.whenParts.length
      ? buildWhenSlot(m.meta.whenParts, { evidence: evs, confidence: m.meta.confidence, lang: sessionLang(m) })
      : unknownSlot({ ko: '언제인가요?', en: 'When is it?' });
    m.when = slot;
  }

  // ------------------------------------------------------------------ ingest
  const openMemories = () => [...S.memories.values()].filter((m) => ACTIVE.has(m.status) && m.kind !== 'person' && !isConstraint(m)).slice(-20);
  const openItemsForPrompt = () => openMemories().map((m) => ({ id: m.id, kind: m.kind, title: m.summary.en || m.summary.ko, when: m.when.value?.displayEn ?? null, status: m.status }));
  // sessions whose text may appear in a prompt (so their cached responses can be purged on deletion)
  const sessionsOfOpenItems = () => [...new Set(openMemories().flatMap((m) => m.evidence.map((e) => uttSession(e.utteranceId))).filter(Boolean))];

  async function runExtraction(utts, tags) {
    const anchor = nowIso();
    const knownIds = new Set(S.memories.keys());
    const fail = (e) => ({ failed: e });
    if (llm && typeof llm.generateJson === 'function') {
      const req = { ...buildExtractRequest(utts, openItemsForPrompt(), anchor), timeoutMs: llmTimeoutMs, tags };
      let res;
      try { res = await llm.generateJson(req); } catch (e) { res = { ok: false, route: 'unknown', error: { code: 'llm_threw', message: String(e?.message ?? e), retryable: true } }; }
      if (res?.ok) {
        const v = validateExtraction(res.json, utts, { knownIds });
        if (v.ok) return { mode: 'model', validation: v, route: { id: res.route, model: res.model, cached: !!res.cached, ms: res.ms }, anchor, raw: res.json };
        return { ...fail(v.error), route: res.route, model: res.model, raw: res.json };
      }
      return { ...fail(res?.error ?? { code: 'llm_failed', message: 'no result' }), route: res?.route, raw: res?.json ?? null };
    }
    return fail({ code: 'no_llm', message: 'no llm injected' });
  }

  async function ingestText({ title, text, lang, provenance = 'synthetic' } = {}) {
    if (!['synthetic', 'consented'].includes(provenance)) return err('provenance_not_allowed', 'only synthetic or explicitly consented text may be ingested');
    if (typeof text !== 'string' || !text.trim()) return err('empty_text', 'text is empty');
    if (S.paused) return err('ingest_paused', 'recording/ingest is paused');
    return locked(async () => {
      if (S.paused) return err('ingest_paused', 'recording/ingest is paused');
      const safeTitle = String(title ?? 'conversation').slice(0, 120);
      const key = sha(`${safeTitle}\n${text}\n${provenance}`);
      for (const ses of S.sessions.values()) if (ses.key === key) {
        return { ok: true, duplicate: true, sessionId: ses.id, utterances: ses.utteranceIds.map((id) => clone(S.utterances.get(id))), memoriesCreated: 0, rejected: 0, rejectedDetail: [], route: clone(ses.route), mode: ses.mode, note: 'identical text already ingested; no model call, no new memories', telemetry: { task: 'extract_memory', mode: ses.mode, route: clone(ses.route), model: ses.route?.model ?? null, rawModelJson: null, validation: null, rejected: 0, duplicate: true, note: 'duplicate ingest: no model call was made, so there is no raw model JSON for this request' } };
      }
      const raw = splitTranscript(text, nowIso());
      if (!raw.length) return err('empty_text', 'no utterances found');
      const sessionId = store.nextId('ses');
      const genGlobal = S.gen.global;
      const failedOut = () => (S.deletedSessions.has(sessionId) || S.gen.global !== genGlobal);

      let ext = await runExtraction(raw, [sessionId, ...sessionsOfOpenItems()]);
      if (failedOut()) return err('deleted_during_ingest', 'session was deleted while the model was running; nothing stored');
      let fallbackReason = null;
      if (!ext.mode) {
        fallbackReason = ext.failed;
        const v = validateExtraction(fallbackExtract(raw), raw, { knownIds: new Set(S.memories.keys()) });
        ext = { mode: 'fallback', validation: v, route: { id: 'fallback-rules', model: 'rules', cached: false, ms: 0, error: fallbackReason }, anchor: nowIso(), raw: null, attempt: { route: ext.route ?? null, model: ext.model ?? null, error: fallbackReason, rawModelJson: ext.raw ?? null } };
      }
      // ---- synchronous commit (no awaits below) ----
      const at = nowIso();
      const sLang = lang === 'ko' || lang === 'en' ? lang : (detectLang(text) === 'ko' ? 'ko' : 'en'); // English-first default
      const utterances = raw.map((u) => {
        const id = store.nextId('utt');
        const rec = { id, sessionId, speakerId: u.speakerId, speakerLabel: u.speakerLabel, speakerKnown: u.speakerKnown, text: u.text, startedAt: u.startedAt, lang: u.lang, provenance, segmentKey: sha(`${key}:${u.index}:${u.text}`).slice(0, 16) };
        S.utterances.set(id, rec); store.indexDoc(`utt:${id}`, u.text);
        return rec;
      });
      const ids = utterances.map((u) => u.id);
      const stats = consolidate(ext.validation.items, { sessionId, ids, provenance, lang: sLang, anchor: at });
      syncProposals();
      S.sessions.set(sessionId, {
        id: sessionId, key, title: safeTitle, provenance, createdAt: at, lang: sLang, utteranceIds: ids, mode: ext.mode, route: ext.route,
        rejected: ext.validation.rejected, rejectedDetail: ext.validation.rejectedDetail,
      });
      return {
        ok: true, sessionId, utterances: clone(utterances), memoriesCreated: stats.created.length, memoryIds: stats.created,
        merged: stats.merged, superseded: stats.superseded, retracted: stats.retracted, cancelled: stats.cancelled, unresolved: stats.unresolved,
        needsUserDecision: stats.pending, rejected: ext.validation.rejected, rejectedDetail: clone(ext.validation.rejectedDetail),
        route: clone(ext.route), mode: ext.mode, ...(fallbackReason ? { fallbackReason } : {}),
        telemetry: {
          task: 'extract_memory', mode: ext.mode, route: clone(ext.route), model: ext.route?.model ?? null, at,
          rawModelJson: ext.mode === 'model' ? clone(ext.raw ?? null) : null,
          validation: { ok: true, accepted: ext.validation.items.length, rejected: ext.validation.rejected, rejectedDetail: clone(ext.validation.rejectedDetail) },
          rejected: ext.validation.rejected,
          ...(ext.attempt ? { modelAttempt: clone(ext.attempt), fallbackReason: clone(fallbackReason) } : {}),
        },
      };
    });
  }

  // ------------------------------------------------------------------ consolidation
  function newMemory(item, ctx, slots) {
    const id = store.nextId('mem');
    const agreement = item.cue === 'agree' ? 'agreed' : item.cue === 'none' ? 'none' : 'proposed';
    const evidence = uniqEvidence(item.evidence.map((e) => evRef(e, ctx.ids)));
    const kind = item.kind;
    const personWho = kind === 'person' && !item.who.length
      ? { state: 'known', value: [{ name: item.title.en || item.title.ko }], display: item.title[ctx.lang] || item.title.en, uncertainty: 'inferred', evidence: [evRef(item.evidence[0], ctx.ids)] }
      : slots.who;
    const m = {
      id, kind, summary: { ko: item.title.ko, en: item.title.en },
      who: personWho, when: slots.when, where: slots.where, what: slots.what,
      status: 'candidate', supersedes: [], evidence, provenance: ctx.provenance, revision: 1,
      meta: {
        sessionId: ctx.sessionId, ref: item.ref, cue: item.cue, lang: ctx.lang, confidence: item.confidence, agreement,
        corroborations: 1, type: item.type ?? null, owner: item.owner ?? null, question: item.question ?? null, missing: item.missing ?? [], whenParts: slots.parts, history: [], pending: [], confirmed: false, createdAt: ctx.anchor, seq: S.seq.mem,
      },
    };
    return m;
  }
  const partsSimple = (parts) => mergeParts(parts);

  function threadScore(m, item, draftWho, draftTitle) {
    const whoOverlap = names(m.who).some((n) => draftWho.some((d) => normName(d) === normName(n))) ? 1 : 0;
    const ts = Math.max(similarity(m.summary.ko, draftTitle.ko), similarity(m.summary.en, draftTitle.en), similarity(m.summary.ko, draftTitle.en), similarity(m.summary.en, draftTitle.ko));
    return whoOverlap * 0.5 + ts;
  }

  function dateCompat(m, c) {
    // c = merged parts of the new item
    const md = memDates(m);
    const nd = new Set([c.date, ...c.dateCandidates].filter(Boolean));
    if (!md.size || !nd.size) return { compatible: true, equal: false };
    for (const d of nd) if (md.has(d)) return { compatible: true, equal: true };
    if (c.flags.includes('bare_weekday') || c.flags.includes('bare_weekday_today')) {
      for (const d of nd) for (const x of md) if (weekdayOf(d) === weekdayOf(x) && Math.abs((Date.parse(d) - Date.parse(x)) / 86400000) <= 14) return { compatible: true, equal: true, weekdayOnly: true };
    }
    return { compatible: false, equal: false };
  }
  const timesConflict = (m, c) => !!(m.when.value?.time && c.time && m.when.value.time !== c.time);

  function addHistory(m, entry) { m.meta.history.push(entry); }

  function applyState(target, type, byMem, evidence, ctx, stats) {
    // Never silently alter a user-confirmed item: record a pending decision instead.
    if (target.status === 'user_confirmed') {
      target.meta.pending.push({ type, by: byMem?.id ?? null, bySessionId: ctx.sessionId, evidence: clone(evidence) });
      stats.pending.push({ memoryId: target.id, type, by: byMem?.id ?? null });
      if (byMem && type === 'superseded') byMem.meta.pendingUpdateOf = target.id;
      return;
    }
    addHistory(target, { type, by: byMem?.id ?? null, bySessionId: ctx.sessionId, evidence: clone(evidence) });
    target.status = type;
    if (type === 'superseded' && byMem) { target.supersededBy = byMem.id; if (!byMem.supersedes.includes(target.id)) byMem.supersedes.push(target.id); }
    target.revision += 1;
    if (type === 'superseded') stats.superseded.push(target.id); else if (type === 'retracted') stats.retracted.push(target.id); else if (type === 'cancelled') stats.cancelled.push(target.id);
  }

  const RELATED_TYPE_RE = /follow[-_ ]?up|related|pick[-_ ]?up|ride|transport|travel|errand/i;
  const CONDITIONAL_RE = /\b(?:if|unless|in case|depending|maybe|might|possibly|probably|not sure|may be)\b|만약|경우|일지도|할지도|수도 있/i;
  function consolidate(items, ctx) {
    const stats = { created: [], merged: [], superseded: [], retracted: [], cancelled: [], unresolved: [], pending: [] };
    const refMap = new Map();
    const ordered = items.map((it, i) => ({ it, i })).sort((a, b) => (a.it.evidence[0].utteranceIndex - b.it.evidence[0].utteranceIndex) || ((a.it.cue === 'cancel') - (b.it.cue === 'cancel')) || (a.i - b.i)).map((x) => x.it);
    const all = () => [...S.memories.values()];
    const resolveTarget = (it) => (it.target ? (refMap.get(it.target) ?? S.memories.get(it.target) ?? null) : null);
    const supersededThisIngest = new Set();

    for (const it of ordered) {
      const slots = slotsFromItem(it, ctx.ids, ctx.lang, ctx.anchor);
      const c = partsSimple(slots.parts);
      const draftWho = it.who.map((w) => w.name);
      const evidence = uniqEvidence(it.evidence.map((e) => evRef(e, ctx.ids)));
      const explicit = resolveTarget(it);

      if (it.cue === 'negation_unavailable') {
        // constraint fact: "Friday no longer works" is NEVER an active Friday appointment.
        let targets = [];
        if (explicit && explicit.kind !== 'fact') targets = [explicit];
        else if (c.matched && (c.date || c.dateCandidates.length)) {
          let pool = all().filter((m) => ACTIVE.has(m.status) && (m.kind === 'event' || m.kind === 'task') && !isConstraint(m) && dateCompat(m, c).equal);
          if (pool.length > 1) {
            const refined = pool.filter((m) => threadScore(m, it, draftWho, it.title) > 0.15);
            pool = refined.length ? refined : [];
          }
          targets = pool;
        }
        if (!c.matched && !targets.length) { stats.unresolved.push({ type: 'negation_no_time_no_target', ref: it.ref, quote: it.evidence[0].quote }); continue; }
        const constraintTitle = { ko: `${slots.when.value?.displayKo ?? '해당 시간'} 불가`, en: `Unavailable ${slots.when.value?.displayEn ?? 'at that time'}` };
        const dupC = all().find((m) => isConstraint(m) && m.when.value?.date === slots.when.value?.date && m.when.value?.time === slots.when.value?.time && m.when.value?.date);
        let cm;
        if (dupC) { dupC.evidence = uniqEvidence([...dupC.evidence, ...evidence]); dupC.meta.corroborations += 1; dupC.revision += 1; cm = dupC; stats.merged.push(dupC.id); }
        else {
          const base = { ...it, kind: 'fact', title: constraintTitle, what: null };
          cm = newMemory(base, ctx, { ...slots, what: { state: 'known', value: { text: 'unavailable', title: constraintTitle }, display: constraintTitle[ctx.lang], uncertainty: 'stated', evidence: [evidence[0]] } });
          cm.meta.constraint = 'unavailable'; cm.meta.agreement = 'none';
          S.memories.set(cm.id, cm); reindexMemory(cm); stats.created.push(cm.id);
        }
        if (it.ref) refMap.set(it.ref, cm);
        for (const t of targets) applyState(t, 'retracted', cm, evidence, ctx, stats);
        if (!targets.length) stats.unresolved.push({ type: 'negation_no_target', ref: it.ref, quote: it.evidence[0].quote });
        continue;
      }

      if (it.cue === 'cancel') {
        // A cancel must be definite. "The walk is off if it rains" is a condition, not a cancellation: never apply it silently.
        if (CONDITIONAL_RE.test(it.evidence.map((e) => e.quote).join(' '))) { stats.unresolved.push({ type: 'conditional_cancel', ref: it.ref, quote: it.evidence[0].quote }); continue; }
        let targets = [];
        if (explicit && explicit.kind !== 'fact') targets = [explicit];
        else {
          let pool = all().filter((m) => ACTIVE.has(m.status) && (m.kind === 'event' || m.kind === 'task') && !isConstraint(m));
          if (c.matched && (c.date || c.dateCandidates.length)) pool = pool.filter((m) => dateCompat(m, c).equal);
          if (c.time) pool = pool.filter((m) => !m.when.value?.time || m.when.value.time === c.time);
          if (pool.length > 1) { const r = pool.filter((m) => threadScore(m, it, draftWho, it.title) > 0.15); pool = r.length ? r : []; }
          if (pool.length > 1) { const best = Math.max(...pool.map((m) => threadScore(m, it, draftWho, it.title))); pool = pool.filter((m) => threadScore(m, it, draftWho, it.title) === best); }
          if (pool.length === 1 && (c.matched || threadScore(pool[0], it, draftWho, it.title) > 0.15)) targets = pool;
        }
        if (!targets.length) { stats.unresolved.push({ type: 'cancel_no_unique_target', ref: it.ref, quote: it.evidence[0].quote }); continue; }
        for (const t of targets) {
          if (supersededThisIngest.has(t.id)) continue; // reschedule already superseded it
          applyState(t, 'cancelled', null, evidence, ctx, stats);
        }
        continue;
      }

      // ---- positive items: propose / agree / replace / none ----
      // 1) replace: find the thing being replaced
      let replaceTarget = null;
      if (it.cue === 'replace') {
        if (explicit && explicit.kind !== 'fact') replaceTarget = explicit;
        else {
          const pool = all().filter((m) => (ACTIVE.has(m.status) || m.status === 'retracted') && (m.kind === 'event' || m.kind === 'task') && !isConstraint(m));
          const scored = pool.map((m) => ({ m, s: threadScore(m, it, draftWho, it.title) })).filter((x) => x.s > 0.15).sort((a, b) => (b.s - a.s) || (b.m.meta.seq - a.m.meta.seq));
          if (scored.length) replaceTarget = scored[0].m;
          else stats.unresolved.push({ type: 'replace_target_not_found', ref: it.ref, quote: it.evidence[0].quote });
        }
      }
      // 2) merge candidate (same thread, compatible date/time)
      let mergeTarget = null; let conflictWith = null;
      if (it.kind === 'person') {
        mergeTarget = all().find((m) => m.kind === 'person' && normName(names(m.who)[0] ?? m.summary.en) === normName(it.who[0]?.name ?? it.title.en)) ?? null;
      } else if (it.cue !== 'replace' && (it.kind === 'event' || it.kind === 'task' || it.kind === 'fact')) {
        // A target LINK is not a revision: a follow-up / related action (pick-up, ride, errand) or any non-agree item whose title is a different
        // thing must stay its own memory and never rewrite the parent's time. Only agree (restating the same thing) may merge through the link.
        const linkedOnly = !!explicit && (RELATED_TYPE_RE.test(it.type ?? '') || (it.cue !== 'agree' && Math.max(similarity(explicit.summary.en, it.title.en), similarity(explicit.summary.ko, it.title.ko)) < 0.3));
        const explicitOk = !!explicit && !linkedOnly && explicit.kind === it.kind && ACTIVE.has(explicit.status);
        const cand = explicitOk ? [explicit] : all().filter((m) => ACTIVE.has(m.status) && m.kind === it.kind && !isConstraint(m) && !(linkedOnly && m.id === explicit.id));
        for (const m of cand.sort((a, b) => b.meta.seq - a.meta.seq)) {
          const dc = c.matched ? dateCompat(m, c) : { compatible: true, equal: false };
          const sameFacts = threadScore(m, it, draftWho, it.title);
          const explicitMatch = explicitOk && explicit.id === m.id;
          const dateOk = dc.compatible && (dc.equal || !c.matched || !memDates(m).size || explicitMatch);
          const strong = explicitMatch || sameFacts > 0.3 || (dc.equal && sameFacts > 0.15);
          if (!dateOk || !strong) continue;
          if (timesConflict(m, c)) { conflictWith = m; continue; } // a different clock time is never merged, even through an explicit link
          mergeTarget = m; break;
        }
      }
      if (!mergeTarget && it.cue === 'agree' && (it.kind === 'event' || it.kind === 'task')) {
        // a bare acceptance ("OK, Saturday 12:30") binds to the most recent open proposal on a compatible date
        mergeTarget = all().filter((m) => ACTIVE.has(m.status) && m.kind === it.kind && !isConstraint(m) && (!c.matched || dateCompat(m, c).equal) && !timesConflict(m, c))
          .sort((a, b) => b.meta.seq - a.meta.seq)[0] ?? null;
      }
      if (mergeTarget) {
        const m = mergeTarget;
        m.evidence = uniqEvidence([...m.evidence, ...evidence]);
        m.meta.corroborations += 1;
        if (m.who.state === 'unknown' && slots.who.state === 'known') m.who = slots.who;
        else if (slots.who.state === 'known') { const have = new Set(names(m.who).map(normName)); const add = slots.who.value.filter((v) => !have.has(normName(v.name))); if (add.length) { m.who = { ...m.who, value: [...m.who.value, ...add], display: [...names(m.who), ...add.map((a) => a.name)].join(', '), evidence: uniqEvidence([...m.who.evidence, ...slots.who.evidence]) }; } }
        if (m.where.state === 'unknown' && slots.where.state === 'known') m.where = slots.where;
        if (slots.parts.length) { m.meta.whenParts = [...m.meta.whenParts, ...slots.parts]; m.when.evidence = uniqEvidence([...(m.when.evidence ?? []), ...slots.when.evidence]); refreshWhen(m); }
        if (AGREE_RANK[it.cue === 'agree' ? 'agreed' : it.cue === 'none' ? 'none' : 'proposed'] > AGREE_RANK[m.meta.agreement]) m.meta.agreement = it.cue === 'agree' ? 'agreed' : 'proposed';
        m.revision += 1; reindexMemory(m); stats.merged.push(m.id);
        if (it.ref) refMap.set(it.ref, m);
        continue;
      }
      const nm = newMemory(it, ctx, slots);
      if (conflictWith) { nm.when.uncertainty = 'conflicting'; conflictWith.when = { ...conflictWith.when, uncertainty: 'conflicting' }; nm.meta.conflictsWith = conflictWith.id; conflictWith.meta.conflictsWith = nm.id; }
      S.memories.set(nm.id, nm); reindexMemory(nm); stats.created.push(nm.id);
      if (it.ref) refMap.set(it.ref, nm);
      if (replaceTarget && replaceTarget.id !== nm.id) {
        // a reschedule that only states a new time keeps the original who/where, as INFERRED slots carrying the original evidence
        for (const k of ['who', 'where']) if (nm[k].state === 'unknown' && replaceTarget[k].state !== 'unknown') {
          nm[k] = { ...clone(replaceTarget[k]), uncertainty: 'inferred', inheritedFrom: replaceTarget.id };
          nm.evidence = uniqEvidence([...nm.evidence, ...nm[k].evidence]);
        }
        // a change of PLACE or PERSON that states no new time ("Can we meet at the library instead?") keeps the original time, ambiguity included
        if (nm.when.state === 'unknown' && replaceTarget.when.state !== 'unknown' && replaceTarget.meta.whenParts.length) {
          nm.when = { ...clone(replaceTarget.when), uncertainty: replaceTarget.when.uncertainty === 'stated' ? 'inferred' : replaceTarget.when.uncertainty, inheritedFrom: replaceTarget.id };
          nm.meta.whenParts = clone(replaceTarget.meta.whenParts);
          nm.evidence = uniqEvidence([...nm.evidence, ...nm.when.evidence]);
        }
        reindexMemory(nm);
        supersededThisIngest.add(replaceTarget.id);
        applyState(replaceTarget, 'superseded', nm, evidence, ctx, stats);
        if (replaceTarget.status === 'retracted') { /* already retracted by an earlier unavailable cue; applyState above handled */ }
      }
    }
    return stats;
  }

  // ------------------------------------------------------------------ read APIs
  function getTranscript(sessionId) {
    const ses = S.sessions.get(sessionId);
    if (!ses) return err('not_found', `no session ${sessionId}`);
    const utterances = ses.utteranceIds.map((id) => clone(S.utterances.get(id)));
    const speakers = []; const seen = new Set();
    for (const u of utterances) if (!seen.has(u.speakerId)) { seen.add(u.speakerId); speakers.push({ id: u.speakerId, label: u.speakerLabel, known: u.speakerKnown }); }
    return { ok: true, sessionId, title: ses.title, provenance: ses.provenance, mode: ses.mode, route: clone(ses.route), speakers, utterances };
  }
  function listMemories({ kind, includeSuperseded = false, status } = {}) {
    return [...S.memories.values()]
      .filter((m) => (kind ? m.kind === kind : true) && (status ? m.status === status : includeSuperseded || ACTIVE.has(m.status)))
      .map(clone);
  }
  function getMemory(id) { const m = S.memories.get(id); return m ? clone(m) : err('not_found', `no memory ${id}`); }

  // ------------------------------------------------------------------ query
  const askedFromText = (t) => {
    const a = [];
    if (/언제|몇\s*시|며칠|무슨\s*요일|\bwhen\b|\bwhen'?s\b|what\s+time|what\s+(?:clock\s+)?time|clock\s+time|part\s+of\s+the\s+day|what\s+hour|which\s+hour|\bam\s+or\s+pm\b|what\s+day|which\s+day|what\s+date|which\s+date|how\s+soon|what'?s the (?:date|time)/i.test(t)) a.push('when');
    if (/어디|장소|\bwhere\b|\bwhere'?s\b|what\s+(?:place|location|address)|which\s+(?:place|location)|\blocation\b|\baddress\b/i.test(t)) a.push('where');
    if (/누구|누가|\bwho\b|\bwho'?s\b|\bwhom\b|\bwhose\b|which\s+(?:person|friend)|\bwith\s+whom\b/i.test(t)) a.push('who');
    if (OTHER_RE.test(t)) a.push('other');
    if (/뭐|무엇|무슨|\bwhat\b|\bwhich\b|해야|\banything\b|\bneed to\b/i.test(t) && !a.length) a.push('what');
    return a;
  };

  function contextForQuery() {
    const mems = [...S.memories.values()].slice(-80).map((m) => ({
      id: m.id, kind: m.kind, status: m.status, title: m.summary, meta: { constraint: m.meta.constraint ?? null, agreement: m.meta.agreement },
      who: names(m.who), when: { display: m.when.value ? { ko: m.when.value.displayKo, en: m.when.value.displayEn } : null, date: m.when.value?.date ?? null, time: m.when.value?.time ?? null, state: m.when.state, candidates: (m.when.candidates ?? []).map((c) => c.labelEn) },
      where: m.where.value?.name ?? null, what: m.what.display ?? null, supersededBy: m.supersededBy ?? null, evidenceUtteranceIds: m.evidence.map((e) => e.utteranceId),
    }));
    const utts = [...S.utterances.values()].slice(-160).map((u) => ({ id: u.id, speaker: u.speakerKnown ? u.speakerLabel : 'unknown', text: u.text }));
    return { mems, utts };
  }

  // Things the who/when/where/what slots cannot answer (route, how, why, price, phone...). A neighbouring memory is NEVER the answer to these.
  const OTHER_RE = /\b(?:bus|buses|route|routes|train|subway|metro|taxi|parking|directions?|how (?:do|can|to|much|long|far|many|often)|price|cost|fee|phone|email|password|why|reason|weather|menu|recipe)\b|노선|버스|지하철|택시|주차|가격|비용|얼마|전화번호|이메일|왜|어떻게|이유|날씨|방법/i;
  const ROLE_RE = /\b(?:told|tell|said|say|called|call|asked|ask|sent|send|gave|give|bring|brings|bringing|brought|invited?|drives?|driving|wrote|suggested|booked|picks?)\b|말했|알려|전화|가져|데려|초대/i;
  // Topical grounding for the "undecided is not absent" rescue: content words of the question vs. the memory's own text/quotes/speakers.
  const NUMW = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };
  const Q_STOP = new Set('what which when who whom where how why part day days does do did can could should will would may might the an of to in on at for is are was were be been before after adding add put go goes going safely safe clock time times hour hours entry calendar am pm mean means meant and or with about this that these those it its me my we us our you your from by as if then there their they them he she his her morning evening afternoon night noon today tomorrow please tell know need needs want name decided decide not yet'.split(' '));
  const AMBIG_Q_RE = /\b(?:am\s+or\s+pm|a\.m\.\s+or\s+p\.m\.|part\s+of\s+the\s+day|morning\s+or\s+(?:evening|afternoon|night)|clock\s+time|what\s+hour|which\s+hour)\b|오전.{0,6}오후/i;
  const wordsOf = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => NUMW[w] ?? w.replace(/(?<=\p{L}{3})s$/u, ''));
  const KIND_RANK = { event: 0, task: 0, fact: 1, person: 2 };

  function answerFrom({ asked: askedIn, memoryIds, modelSlots: modelSlotsIn, notFoundReason, lang, mode, route, negative = false, question = '' }) {
    // 'other' = something outside who/when/where/what; 'negative' = the model itself said it found nothing
    const askedOther = askedIn.includes('other');
    const asked = askedIn.filter((k) => k !== 'other');
    let modelSlots = negative ? null : modelSlotsIn;
    // choose memories
    let found = []; const inactive = [];
    for (const id of memoryIds) {
      let m = S.memories.get(id); let hops = 0;
      while (m && m.status === 'superseded' && m.supersededBy && hops++ < 6) m = S.memories.get(m.supersededBy) ?? null;
      if (!m) continue;
      if (ACTIVE.has(m.status)) { if (!found.some((x) => x.id === m.id)) found.push(m); } else if (!inactive.some((x) => x.id === m.id)) inactive.push(m);
    }
    // events/tasks answer better than a bare person card; keep the model's order inside a rank
    found = found.map((m, i) => ({ m, i })).sort((a, b) => ((KIND_RANK[a.m.kind] ?? 1) - (KIND_RANK[b.m.kind] ?? 1)) || (a.i - b.i)).map((x) => x.m);
    // an unsupported kind of question gets no neighbouring memory as its "answer"
    const otherAsked = (askedOther || OTHER_RE.test(question)) && !(modelSlots?.other && verifyQuote(modelSlots.other.utteranceId, modelSlots.other.quote) && valueBoundToQuote(modelSlots.other.value, modelSlots.other.quote));
    if (otherAsked && !asked.length) { found = []; modelSlots = null; }
    // The model said "not found" but cited an ACTIVE memory whose asked slot is only undecided (AM/PM not decided, day not fixed):
    // that is a clarification ("Is that AM or PM?"), never the generic absent sentence. The model's own slots are ignored; AM/PM is never picked.
    let rescued = false;
    if (negative) {
      const want = [...new Set([...asked, ...askedFromText(question).filter((k) => k !== 'other')])].filter((k) => k !== 'what');
      const isUnd = (m) => want.some((k) => ['ambiguous', 'partial'].includes(m[k]?.state) && verified(m[k].evidence).length);
      const qTok = [...new Set(wordsOf(question).filter((w) => !Q_STOP.has(w) && w.length > 1))];
      const memCorpus = (m) => {
        const us = m.evidence.map((e) => S.utterances.get(e.utteranceId)).filter(Boolean);
        return new Set(wordsOf([m.summary.en, m.summary.ko, names(m.who).join(' '), m.where.display, m.what.display, ...m.evidence.map((e) => e.quote), ...us.map((u) => u.text), ...us.map((u) => (u.speakerKnown ? u.speakerLabel : ''))].join(' ')));
      };
      const overlap = (m) => { const c = memCorpus(m); return qTok.filter((w) => c.has(w)).length; };
      const blocked = otherAsked && !asked.length;
      // (1) the model cited the memory itself: it must be topical (or the question is plainly about AM/PM)
      let und = blocked ? [] : found.filter((m) => isUnd(m) && (overlap(m) >= 1 || AMBIG_Q_RE.test(question)));
      // (2) the model cited nothing: ground the question in ONE active event whose time is undecided, by >=2 shared content words and a unique best score.
      //     A question about something no memory mentions ("When is the dentist visit?") shares no words, so it stays absent.
      if (!und.length && !blocked && want.includes('when')) {
        const sc = [...S.memories.values()].filter((m) => ACTIVE.has(m.status) && (m.kind === 'event' || m.kind === 'task') && !isConstraint(m) && isUnd(m))
          .map((m) => ({ m, s: overlap(m) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s);
        if (sc.length && (sc.length === 1 || sc[0].s > sc[1].s)) und = [sc[0].m];
      }
      if (und.length) { found = und; rescued = true; } else found = [];
    }
    const primary = found[0] ?? null;
    const slots = { who: unknownSlot(), when: unknownSlot(), where: unknownSlot(), what: unknownSlot() };
    if (primary) for (const k of ['who', 'when', 'where', 'what']) {
      const sl = clone(primary[k]); sl.evidence = verified(sl.evidence);
      slots[k] = sl.evidence.length && !(primary.kind === 'person' && k === 'what') ? sl : unknownSlot(primary[k].clarification);
    }
    // model-provided direct slots only fill gaps, and only when (1) the quote is verbatim AND (2) the value is bound to the quote (GAP1):
    //  who/where: the value must appear in the quote; when: the quote itself is parsed (the model's wording is ignored) or, if it has no
    //  time reading, the value must appear in the quote; what: paraphrase is allowed (inferred) but still needs a verbatim quote.
    const rejectedSlots = []; let speakerWho = false;
    // A role-bound model slot for who/where REPLACES the memory-wide value (a memory can mention several people in different roles).
    let roleBound = false;
    const mo = modelSlots?.other;
    if (mo && (askedOther || OTHER_RE.test(question)) && slots.what.state === 'unknown') {
      const ref = verifyQuote(mo.utteranceId, mo.quote);
      if (ref && valueBoundToQuote(mo.value, mo.quote)) slots.what = { state: 'known', value: { text: mo.value }, display: mo.value, uncertainty: 'inferred', evidence: [ref] };
      else rejectedSlots.push({ slot: 'what', reason: ref ? 'value_not_in_quote' : 'quote_not_verbatim' });
    }
    for (const k of ['who', 'when', 'where', 'what']) {
      const ms = modelSlots?.[k]; if (!ms) continue;
      const existing = slots[k].state !== 'unknown';
      if (existing && !(k === 'who' || k === 'where')) continue;
      if (existing && normBind(slots[k].display) === normBind(ms.value)) continue; // same value: keep the memory's (stronger) evidence
      const ref = verifyQuote(ms.utteranceId, ms.quote);
      if (existing) {
        const ok = ref && (valueBoundToQuote(ms.value, ms.quote) || (k === 'who' && speakerIs(ms.utteranceId, ms.value)));
        if (!ok) continue; // unbound model value never replaces verified memory evidence
        const fromSpeaker = k === 'who' && !valueBoundToQuote(ms.value, ms.quote);
        slots[k] = { state: 'known', value: { text: ms.value, ...(fromSpeaker ? { fromSpeakerLabel: true } : {}) }, display: ms.value, uncertainty: 'inferred', evidence: [ref] };
        if (fromSpeaker) speakerWho = true;
        roleBound = true; continue;
      }
      if (!ref) { rejectedSlots.push({ slot: k, reason: 'quote_not_verbatim' }); continue; }
      if (k === 'when') {
        const p = parseTimePhrase(ms.quote, nowIso());
        if (p.matched) slots.when = buildWhenSlot([p], { evidence: [ref], lang });
        else if (valueBoundToQuote(ms.value, ms.quote)) slots.when = { state: 'partial', value: { raw: ms.quote }, display: ms.value, uncertainty: 'inferred', evidence: [ref] };
        else rejectedSlots.push({ slot: k, reason: 'value_not_in_quote' });
      } else if (k === 'what' || valueBoundToQuote(ms.value, ms.quote)) {
        slots[k] = { state: 'known', value: { text: ms.value }, display: ms.value, uncertainty: 'inferred', evidence: [ref] };
      } else if (k === 'who' && speakerIs(ms.utteranceId, ms.value)) {
        // first-person statements ("I'll bring the cake"): the speaker label of THAT utterance is the source of the name
        slots.who = { state: 'known', value: { text: ms.value, fromSpeakerLabel: true }, display: ms.value, uncertainty: 'inferred', evidence: [ref] };
        speakerWho = true;
      } else rejectedSlots.push({ slot: k, reason: 'value_not_in_quote' });
    }
    // several people in one memory and a role question ("who told us", "who is bringing"), with no role-bound quote: do not guess the role
    if (asked.includes('who') && !roleBound && slots.who.state === 'known' && Array.isArray(slots.who.value) && slots.who.value.length > 1 && ROLE_RE.test(question)) {
      const nm = slots.who.value.map((v) => v.name);
      slots.who = { ...slots.who, state: 'ambiguous', uncertainty: 'ambiguous', display: `${nm.join(' or ')} (which one?)`, clarification: { ko: '어느 분을 말씀하시나요?', en: 'Which person do you mean?' },
        candidates: nm.map((n) => ({ labelKo: n, labelEn: n, value: { name: n } })) };
    }
    const anyKnown = Object.values(slots).some((s) => s.state !== 'unknown' && s.evidence.length);
    const askedEff = asked.length ? asked : ['when', 'where', 'who', 'what'];
    const caveats = [];
    const evs = uniqEvidence(Object.values(slots).flatMap((s) => s.evidence));
    if (evs.length && evs.every((e) => !S.utterances.get(e.utteranceId)?.speakerKnown)) caveats.push('speaker_unknown');
    if (primary?.status === 'candidate') caveats.push('unconfirmed');
    if (evs.length === 1) caveats.push('single_source');
    if (primary && isConstraint(primary)) caveats.push('constraint_not_appointment');
    if (primary?.when?.state === 'ambiguous') caveats.push('time_ambiguous');
    if (primary?.meta.pending?.length) caveats.push('change_pending_user_decision');
    if (rejectedSlots.length) caveats.push('model_value_not_in_source');
    if (speakerWho) caveats.push('who_from_speaker_label');
    if (rescued) caveats.push('model_said_not_found_but_undecided');
    const ans = { found: anyKnown, mode, route, slots, caveats, ...(rejectedSlots.length ? { rejectedSlots } : {}), memoryId: primary?.id ?? null, matches: found.map((m) => ({ memoryId: m.id, kind: m.kind, status: m.status, summary: clone(m.summary), slots: { who: m.who.display ?? null, when: m.when.value ? { ko: m.when.value.displayKo, en: m.when.value.displayEn } : null, where: m.where.display ?? null } })) };
    if (!anyKnown) {
      const unverified = !inactive.length && rejectedSlots.length > 0;
      const reason = inactive.length ? inactive[0].status : unverified ? 'unverified_model_value' : (notFoundReason ?? 'not_in_memory');
      ans.found = false; ans.notFoundReason = reason; ans.notFoundCode = inactive.length ? inactive[0].status : unverified ? 'unverified_model_value' : 'not_in_memory';
      if (inactive.length) ans.memoryId = inactive[0].id;
      ans.sentence = reason === 'cancelled' ? { ko: '그 일정은 취소되었어요.', en: 'That plan was cancelled.' }
        : reason === 'retracted' ? { ko: '그 일정은 철회되었어요(그 시간은 안 된다고 했어요).', en: 'That plan was withdrawn (that time no longer works).' }
        : unverified ? { ko: '저장된 대화에서 확인할 수 없었어요.', en: "I couldn't confirm that from the saved conversations." }
        : { ko: '저장된 대화에는 그 내용이 없어요.', en: "I don't have that in your conversations." };
      if (unverified) {
        const k = rejectedSlots[0].slot;
        const prompts = { who: { ko: '누구인가요?', en: 'Who is it?' }, when: { ko: '언제인가요?', en: 'When is it?' }, where: { ko: '어디인가요?', en: 'Where is it?' }, what: { ko: '무엇인가요?', en: 'What is it?' } };
        ans.clarification = { slot: k, prompt: prompts[k], options: [], allowFreeInput: true, allowUnknown: true };
      }
      return ans;
    }
    const lab = { who: ['누구', 'Who'], when: ['언제', 'When'], where: ['어디', 'Where'], what: ['무엇', 'What'] };
    const txt = (k, l) => {
      const s = slots[k];
      if (s.state === 'unknown' || !s.evidence.length) return l === 'ko' ? '아직 들은 적 없어요' : 'not mentioned yet';
      if (k === 'when') return l === 'ko' ? s.value.displayKo ?? s.display : s.value.displayEn ?? s.display;
      if (k === 'what') return l === 'ko' ? (s.value.title?.ko ?? s.display) : (s.value.title?.en ?? s.display);
      return s.display;
    };
    const head = primary && !asked.includes('what') ? { ko: primary.summary.ko, en: primary.summary.en } : null;
    ans.sentence = {
      ko: `${head ? `${head.ko} — ` : ''}${askedEff.map((k) => `${lab[k][0]}: ${txt(k, 'ko')}`).join(' · ')}`,
      en: `${head ? `${head.en} — ` : ''}${askedEff.map((k) => `${lab[k][1]}: ${txt(k, 'en')}`).join(' · ')}`,
    };
    // clarification: first asked slot that is ambiguous/unknown
    for (const k of askedEff) {
      const s = slots[k];
      if (k === 'what') continue;
      if (s.state === 'ambiguous') {
        ans.clarification = { slot: k, prompt: s.clarification ?? { ko: '확인이 필요해요.', en: 'Please confirm.' },
          options: (s.candidates ?? []).map((c) => ({ label: c.labelKo, labelEn: c.labelEn, value: c.value ?? { date: c.date, time: c.time, startIso: c.startIso }, uncertainty: 'ambiguous', evidence: s.evidence })), allowFreeInput: true, allowUnknown: true };
        break;
      }
      if (s.state === 'unknown' || s.state === 'partial') {
        const prompts = { when: { ko: s.clarification?.ko ?? '언제인가요?', en: s.clarification?.en ?? 'When is it?' }, where: { ko: '어디인가요?', en: 'Where is it?' }, who: { ko: '누구인가요?', en: 'Who is it?' } };
        ans.clarification = { slot: k, prompt: prompts[k], options: [], allowFreeInput: true, allowUnknown: true };
        break;
      }
    }
    return ans;
  }

  // GAP1: a model-supplied value must be BOUND to its quote. Substring (ignoring case/spacing/punctuation) or every substantial token present.
  const BIND_STOP = new Set(['the', 'a', 'an', 'at', 'in', 'of', 'to', 'dr', 'mr', 'mrs', 'ms']);
  const normBind = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  function valueBoundToQuote(value, quote) {
    const v = normBind(value); const q = normBind(quote);
    if (!v || !q) return false;
    if (q.includes(v)) return true;
    const toks = String(value).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !BIND_STOP.has(t));
    return toks.length > 0 && toks.every((t) => q.includes(normBind(t)));
  }

  function speakerIs(utteranceId, value) {
    const u = S.utterances.get(utteranceId);
    return !!u && u.speakerKnown && normBind(u.speakerLabel) !== '' && normBind(u.speakerLabel) === normBind(value);
  }

  function verifyQuote(utteranceId, quote) {
    const u = S.utterances.get(utteranceId);
    if (!u || typeof quote !== 'string' || !quote) return null;
    const i = u.text.indexOf(quote);
    return i < 0 ? null : { utteranceId, charStart: i, charEnd: i + quote.length, quote };
  }

  function fallbackQuery(text, lang, why, attemptRaw = null) {
    const asked = askedFromText(text);
    const hits = store.search(text, 12).filter((h) => h.docId.startsWith('mem:'));
    const ids = hits.map((h) => h.docId.slice(4)).filter((id) => { const m = S.memories.get(id); return m && (ACTIVE.has(m.status)) && !isConstraint(m); });
    const a = answerFrom({ asked, question: text, memoryIds: ids.slice(0, 1), modelSlots: null, notFoundReason: 'not_in_memory', lang, mode: 'fallback', route: { id: 'fallback-rules', model: 'keyword-search', error: why } });
    a.fallbackNote = 'FALLBACK: keyword search over stored memories, no model';
    a.telemetry = { task: 'answer_question', mode: 'fallback', route: clone(a.route), model: a.route?.model ?? null, rawModelJson: null, validation: { ok: false, accepted: 0, rejected: 0, reason: why ?? null }, rejected: 0, fallbackReason: clone(why ?? null), modelAttempt: { error: why ?? null, rawModelJson: clone(attemptRaw) } };
    return a;
  }

  async function query({ text, lang = 'en' } = {}) {
    if (typeof text !== 'string' || !text.trim()) return err('empty_question', 'question is empty');
    if (!S.memories.size && !S.utterances.size) {
      return { found: false, mode: 'none', slots: { who: unknownSlot(), when: unknownSlot(), where: unknownSlot(), what: unknownSlot() }, caveats: [], matches: [], notFoundReason: 'no_memory', sentence: { ko: '아직 저장된 대화가 없어요.', en: 'There are no saved conversations yet.' } };
    }
    return locked(async () => {
      const dataGen = () => S.gen.data ?? 0;
      const g0 = dataGen(); const gl0 = S.gen.global;
      const { mems, utts } = contextForQuery();
      let res = null;
      if (llm && typeof llm.generateJson === 'function') {
        const tags = [...new Set([...S.sessions.keys()])];
        const req = { ...buildQueryRequest({ question: text, lang, utterances: utts, memories: mems, nowIso: nowIso() }), timeoutMs: llmTimeoutMs, tags };
        try { res = await llm.generateJson(req); } catch (e) { res = { ok: false, route: 'unknown', error: { code: 'llm_threw', message: String(e?.message ?? e), retryable: true } }; }
      } else res = { ok: false, route: 'none', error: { code: 'no_llm', message: 'no llm injected', retryable: false } };
      if (dataGen() !== g0 || S.gen.global !== gl0) return err('aborted_by_delete', 'memory was deleted while the model was answering; answer discarded');
      if (!res.ok) return fallbackQuery(text, lang, res.error, res.json ?? null);
      const v = validateQuery(res.json);
      if (!v.ok) return fallbackQuery(text, lang, v.error, res.json);
      const route = { id: res.route, model: res.model, cached: !!res.cached, ms: res.ms };
      const a = answerFrom({ asked: v.asked.length ? v.asked : askedFromText(text), question: text, negative: v.found === false, memoryIds: v.memoryIds, modelSlots: v.slots, notFoundReason: v.notFoundReason, lang, mode: 'model', route });
      if (!v.found && !a.found && a.notFoundCode !== 'unverified_model_value') a.notFoundReason = v.notFoundReason ?? a.notFoundReason;
      a.telemetry = { task: 'answer_question', mode: 'model', route: clone(route), model: res.model ?? null, rawModelJson: clone(res.json), validation: { ok: true, accepted: Object.values(a.slots).filter((s) => s.state !== 'unknown' && s.evidence.length).length, rejected: (a.rejectedSlots ?? []).length, found: v.found, memoryIds: v.memoryIds, rejectedSlots: clone(a.rejectedSlots ?? []) }, rejected: (a.rejectedSlots ?? []).length };
      return a;
    });
  }

  // ------------------------------------------------------------------ proposals
  const joinNames = (slot) => names(slot).join(', ');
  function recomputeProposal(p) {
    const f = p.fields; const missing = [];
    if (f.kind === 'appointment') { if (!f.startsAt) missing.push(...(p.meta.whenMissing?.length ? p.meta.whenMissing : ['when.date', 'when.time'])); }
    p.missing = missing;
    const wk = f.startsAt ? `${fmtDate(f.startsAt.slice(0, 10)).ko} ${fmtTime(f.startsAt.slice(11, 16)).ko}` : null;
    const we = f.startsAt ? `${fmtDate(f.startsAt.slice(0, 10)).en} ${fmtTime(f.startsAt.slice(11, 16)).en}` : null;
    const stateKo = p.state === 'user_confirmed' ? '확인함 · 아직 실행 전' : p.state === 'cancelled' ? '취소됨' : p.state === 'expired' ? '만료됨 · 원래 일정이 바뀌었거나 취소됐어요' : p.state === 'needs_info' ? '정보 필요' : '확인 전';
    const stateEn = p.state === 'user_confirmed' ? 'confirmed by you · not yet executed' : p.state === 'cancelled' ? 'cancelled' : p.state === 'expired' ? 'expired · the original plan was changed or cancelled' : p.state === 'needs_info' ? 'needs more info' : 'not yet confirmed';
    p.readback = {
      ko: `${wk ?? '시간 미정'} · ${f.title}${f.where ? ` (${f.where})` : ''}${f.who ? ` · ${f.who}` : ''} — ${f.kind === 'todo' ? '할 일 추가' : '일정 추가'} (${stateKo})`,
      en: `${we ?? 'time not set'} · ${f.title}${f.where ? ` (${f.where})` : ''}${f.who ? ` · ${f.who}` : ''} — ${f.kind === 'todo' ? 'add to to-do list' : 'add to calendar'} (${stateEn})`,
    };
    if (!['user_confirmed', 'cancelled', 'expired'].includes(p.state)) p.state = missing.length ? 'needs_info' : 'proposed';
    return p;
  }
  function whenMissing(m) {
    const w = m.when;
    if (w.state === 'known') return [];
    if (w.state === 'ambiguous') { const o = []; if (!w.value?.date) o.push('when.date'); if (!w.value?.time) o.push('when.ampm'); return o; }
    const o = []; if (!w.value?.date) o.push('when.date'); if (!w.value?.time) o.push('when.time'); return o;
  }
  function propose(memoryId) {
    const m = S.memories.get(memoryId);
    if (!m) return err('not_found', `no memory ${memoryId}`);
    if (!ACTIVE.has(m.status)) return err('memory_not_active', `memory is ${m.status}; cannot propose`, { status: m.status });
    if (m.kind === 'person' || isConstraint(m)) return err('not_proposable', 'only events and tasks can become proposals');
    const lang = sessionLang(m);
    const kind = m.kind === 'task' ? 'todo' : 'appointment';
    const exact = m.when.state === 'known' && m.when.value?.startIso;
    const fields = {
      kind, title: m.summary[lang] || m.summary.ko, who: joinNames(m.who) || undefined, startsAt: exact ? m.when.value.startIso : undefined,
      where: m.where.value?.name, remindOffsetsMin: kind === 'appointment' ? [60] : [], sourceMemoryIds: [m.id],
    };
    const existing = [...S.proposals.values()].find((p) => p.fields.sourceMemoryIds[0] === m.id && !['cancelled', 'expired'].includes(p.state));
    const slotUncertainty = { who: m.who.uncertainty, when: m.when.uncertainty, where: m.where.uncertainty, what: m.what.uncertainty };
    if (existing) {
      if (existing.meta.memoryRevision === m.revision) return clone(existing);
      {
        // the source memory changed since this proposal was built: refresh it and require a NEW confirmation (never reuse a stale confirmation)
        if (existing.state === 'user_confirmed') { existing.state = 'proposed'; existing.meta.confirmedRevision = null; }
        delete existing.meta.stale;
        existing.fields = { ...fields, remindOffsetsMin: existing.fields.remindOffsetsMin };
        existing.meta.memoryRevision = m.revision; existing.meta.whenMissing = kind === 'appointment' ? whenMissing(m) : [];
        existing.slotUncertainty = slotUncertainty; existing.evidence = clone(verified(m.evidence)); existing.revision += 1;
        recomputeProposal(existing); setDuplicate(existing); return clone(existing);
      }
    }
    const p = {
      id: store.nextId('prop'), revision: 1, fields, state: 'proposed', missing: [], slotUncertainty, evidence: clone(verified(m.evidence)), readback: { ko: '', en: '' },
      meta: { memoryRevision: m.revision, whenMissing: kind === 'appointment' ? whenMissing(m) : [], confirmedRevision: null, seq: S.seq.prop },
    };
    recomputeProposal(p); setDuplicate(p); S.proposals.set(p.id, p);
    return clone(p);
  }
  function setDuplicate(p) {
    const d = findDuplicatesRaw(p.fields, p.id)[0];
    if (d) p.duplicateOf = d.id; else delete p.duplicateOf;
  }
  function findDuplicatesRaw(fields, excludeId) {
    const out = [];
    for (const p of S.proposals.values()) {
      if (p.id === excludeId || ['cancelled', 'expired'].includes(p.state) || p.fields.kind !== fields.kind) continue;
      const g = p.fields; const titleSim = Math.max(similarity(g.title, fields.title), 0);
      const whoMatch = g.who && fields.who && normName(g.who) === normName(fields.who);
      const related = titleSim >= 0.34 || whoMatch;
      let timeNear = false;
      if (g.startsAt && fields.startsAt) timeNear = g.startsAt.slice(0, 10) === fields.startsAt.slice(0, 10) && Math.abs(Date.parse(g.startsAt) - Date.parse(fields.startsAt)) <= 120 * 60000;
      else if (!g.startsAt && !fields.startsAt) timeNear = titleSim >= 0.6;
      if (related && timeNear) out.push(p);
    }
    return out;
  }
  const findDuplicates = (fields, opts = {}) => findDuplicatesRaw(fields ?? {}, opts.excludeId).map(clone);

  function updateProposal(id, patch = {}) {
    const p = S.proposals.get(id);
    if (!p) return err('not_found', `no proposal ${id}`);
    if (['cancelled', 'expired'].includes(p.state)) return err('proposal_closed', `proposal is ${p.state}`);
    const f = { ...p.fields }; let changed = false;
    const setIf = (k, v) => { if (JSON.stringify(f[k]) !== JSON.stringify(v)) { f[k] = v; changed = true; } };
    if ('title' in patch) { const t = String(patch.title ?? '').trim(); if (!t) return err('invalid_title', 'title must not be empty'); setIf('title', t.slice(0, 160)); }
    if ('who' in patch) setIf('who', patch.who ? String(patch.who).slice(0, 120) : undefined);
    if ('where' in patch) setIf('where', patch.where ? String(patch.where).slice(0, 160) : undefined);
    if ('kind' in patch) { if (!['appointment', 'todo'].includes(patch.kind)) return err('invalid_kind', 'kind must be appointment|todo'); setIf('kind', patch.kind); }
    if ('remindOffsetsMin' in patch) {
      const r = patch.remindOffsetsMin;
      if (!Array.isArray(r) || r.some((x) => !Number.isInteger(x) || x < 0 || x > 10080)) return err('invalid_reminders', 'remindOffsetsMin must be integers 0..10080');
      setIf('remindOffsetsMin', [...new Set(r)].sort((a, b) => b - a));
    }
    if ('startsAt' in patch) {
      if (patch.startsAt === null || patch.startsAt === undefined || patch.startsAt === '') setIf('startsAt', undefined);
      else {
        if (typeof patch.startsAt !== 'string' || !ISO_OFFSET.test(patch.startsAt) || Number.isNaN(Date.parse(patch.startsAt))) return err('invalid_startsAt', 'startsAt must be ISO 8601 with offset, e.g. 2026-11-17T15:00:00+09:00');
        const before = f.startsAt;
        setIf('startsAt', seoulIso(patch.startsAt));
        if (f.startsAt !== before) { p.slotUncertainty = { ...p.slotUncertainty, when: 'stated' }; p.meta.whenMissing = []; }
      }
    }
    if ('endsAt' in patch) setIf('endsAt', patch.endsAt ? seoulIso(patch.endsAt) : undefined);
    if (!changed) return clone(p);
    p.fields = f; p.revision += 1;
    if (p.state === 'user_confirmed') { p.state = 'proposed'; p.meta.confirmedRevision = null; }
    if (f.startsAt) p.meta.whenMissing = [];
    recomputeProposal(p); setDuplicate(p);
    return clone(p);
  }
  function cancelProposal(id) {
    const p = S.proposals.get(id);
    if (!p) return err('not_found', `no proposal ${id}`);
    if (p.state === 'cancelled') return clone(p);
    p.state = 'cancelled'; p.revision += 1; recomputeProposal(p);
    for (const mid of p.fields.sourceMemoryIds) { const m = S.memories.get(mid); if (m && m.meta.confirmedBy === id) { m.meta.confirmed = false; delete m.meta.confirmedBy; if (m.status === 'user_confirmed') { m.status = statusFromHistory(m); m.revision += 1; } } }
    return clone(p);
  }
  function markConfirmed(id, revision) {
    const p = S.proposals.get(id);
    if (!p) return err('not_found', `no proposal ${id}`);
    if (['cancelled', 'expired'].includes(p.state)) return closedError(p);
    const bad = revalidateSource(p); if (bad) return bad;
    if (revision !== p.revision) return err('stale_revision', `proposal is at revision ${p.revision}, not ${revision}`, { currentRevision: p.revision });
    if (p.state === 'user_confirmed' && p.meta.confirmedRevision === revision) return { ...clone(p), idempotent: true };
    if (p.state === 'needs_info') return err('needs_info', 'proposal is missing information', { missing: clone(p.missing) });
    p.state = 'user_confirmed'; p.meta.confirmedRevision = revision; recomputeProposal(p);
    for (const mid of p.fields.sourceMemoryIds) { const m = S.memories.get(mid); if (m && ACTIVE.has(m.status) && !m.meta.confirmed) { m.meta.confirmed = true; m.meta.confirmedBy = id; m.status = 'user_confirmed'; m.revision += 1; } }
    p.meta.memoryRevision = S.memories.get(p.fields.sourceMemoryIds[0])?.revision ?? p.meta.memoryRevision; // our own confirm bump is not a source change
    return clone(p);
  }

  // GAP2: a proposal is only as valid as the memory it came from. Re-check the source at confirm AND at execute; never revive a stale action.
  const TERMINAL_SOURCE = new Set(['source_deleted', 'source_cancelled', 'source_superseded', 'source_retracted']);
  function sourceProblem(p) {
    for (const mid of p.fields.sourceMemoryIds) {
      const m = S.memories.get(mid);
      if (!m) return { code: 'source_deleted', memoryId: mid, message: 'the conversation this proposal came from was deleted' };
      if (!ACTIVE.has(m.status)) return { code: `source_${m.status}`, memoryId: mid, status: m.status, ...(m.supersededBy ? { supersededBy: m.supersededBy } : {}), message: `the source plan is now ${m.status}` };
      if (m.meta.pending?.length) return { code: 'source_change_pending', memoryId: mid, message: 'a later conversation changed or cancelled this plan; the user must decide first' };
      if (m.revision !== p.meta.memoryRevision) return { code: 'source_changed', memoryId: mid, currentRevision: m.revision, message: 'the source plan changed after this proposal was made; propose it again' };
    }
    return null;
  }
  // every refusal caused by the SOURCE memory uses code source_changed; error.reason carries the specific cause (source_cancelled|source_superseded|source_retracted|source_deleted|source_change_pending|source_changed)
  const closedError = (p) => (p.meta.expiredReason ? err('source_changed', `proposal expired: ${p.meta.expiredReason}`, { reason: p.meta.expiredReason, proposalState: p.state, ...(p.meta.supersededBy ? { supersededBy: p.meta.supersededBy } : {}) }) : err('proposal_closed', `proposal is ${p.state}`));
  function expireProposal(p, problem) {
    if (['cancelled', 'expired'].includes(p.state)) return;
    p.state = 'expired'; p.revision += 1; p.meta.expiredReason = problem.code; if (problem.supersededBy) p.meta.supersededBy = problem.supersededBy; p.meta.confirmedRevision = null; delete p.meta.stale;
    recomputeProposal(p);
  }
  /** returns an error result (and expires the proposal when the source is gone/cancelled/superseded) or null when the source is still valid */
  function revalidateSource(p) {
    const bad = sourceProblem(p);
    if (!bad) { delete p.meta.stale; return null; }
    if (TERMINAL_SOURCE.has(bad.code)) { expireProposal(p, bad); return err('source_changed', bad.message, { reason: bad.code, proposalState: p.state, memoryId: bad.memoryId, ...(bad.supersededBy ? { supersededBy: bad.supersededBy } : {}) }); }
    p.meta.stale = { code: bad.code, memoryId: bad.memoryId };
    return err('source_changed', bad.message, { reason: bad.code, proposalState: p.state, memoryId: bad.memoryId, ...(bad.currentRevision ? { currentRevision: bad.currentRevision } : {}) });
  }
  function syncProposals() {
    for (const p of S.proposals.values()) {
      if (['cancelled', 'expired'].includes(p.state)) continue;
      const bad = sourceProblem(p);
      if (!bad) { delete p.meta.stale; continue; }
      if (TERMINAL_SOURCE.has(bad.code)) expireProposal(p, bad); else p.meta.stale = { code: bad.code, memoryId: bad.memoryId };
    }
  }
  /** Call right before executing an action: ok only for a user_confirmed proposal whose source is unchanged since the confirmation. */
  function validateForExecution(id) {
    const p = S.proposals.get(id);
    if (!p) return err('not_found', `no proposal ${id}`);
    if (['cancelled', 'expired'].includes(p.state)) return closedError(p);
    const bad = revalidateSource(p); if (bad) return bad;
    if (p.state !== 'user_confirmed' || p.meta.confirmedRevision !== p.revision) return err('not_confirmed', 'the user has not confirmed the current version of this proposal', { proposalState: p.state });
    return { ok: true, proposal: clone(p) };
  }
  /** The user's decision about a later change to a plan they had confirmed (decision: 'apply' | 'dismiss'). */
  function resolvePending(memoryId, decision) {
    const m = S.memories.get(memoryId);
    if (!m) return err('not_found', `no memory ${memoryId}`);
    if (!m.meta.pending?.length) return err('nothing_pending', 'no pending change for this memory');
    if (!['apply', 'dismiss'].includes(decision)) return err('invalid_decision', 'decision must be apply|dismiss');
    const last = m.meta.pending[m.meta.pending.length - 1];
    if (decision === 'apply') {
      m.meta.confirmed = false; delete m.meta.confirmedBy; m.status = 'candidate';
      const by = last.by ? S.memories.get(last.by) ?? null : null;
      m.meta.pending = [];
      applyState(m, last.type, by, last.evidence ?? [], { sessionId: last.bySessionId }, { superseded: [], retracted: [], cancelled: [], pending: [] });
    } else m.meta.pending = []; // dismissed: the user keeps the plan; nothing material changed, so confirmed proposals stay valid
    syncProposals();
    return clone(m);
  }
  function getProposal(id) { const p = S.proposals.get(id); return p ? clone(p) : err('not_found', `no proposal ${id}`); }
  function setActionRecord(id, recordId) {
    const p = S.proposals.get(id); if (!p) return err('not_found', `no proposal ${id}`);
    p.actionRecordId = String(recordId); return clone(p);
  }

  // ------------------------------------------------------------------ storage + deletion
  function getStorageSummary() {
    return { sessions: S.sessions.size, utterances: S.utterances.size, memories: S.memories.size, proposals: S.proposals.size, searchTerms: S.index.size, paused: S.paused };
  }
  function setPaused(v) { S.paused = !!v; return { paused: S.paused }; }

  async function llmPurge(arg) {
    if (!llm) return { name: 'llm_cache', status: 'not_applicable', detail: 'no llm injected' };
    if (typeof llm.purgeCache !== 'function') return { name: 'llm_cache', status: 'not_verified', detail: 'llm router has no purgeCache(); cached responses may still hold transcript text' };
    try {
      const r = await llm.purgeCache(arg);
      // accepted shapes: {verified:boolean, removed?:n} or a bare receipt status string (lead router returns 'verified_deleted')
      if (typeof r === 'string') return { name: 'llm_cache', status: ['verified_deleted', 'not_deleted', 'not_verified', 'not_applicable'].includes(r) ? r : 'not_verified', detail: `router returned "${r}"` };
      return { name: 'llm_cache', status: r && r.verified ? 'verified_deleted' : 'not_verified', detail: `removed ${r?.removed ?? '?'} cached responses` };
    } catch (e) { return { name: 'llm_cache', status: 'not_verified', detail: `purgeCache threw: ${String(e?.message ?? e)}` }; }
  }

  async function finishReceipt(scope, coreStores, purgeArg) {
    const stores = [...coreStores, await llmPurge(purgeArg)];
    for (const name of RECEIPT_STORES) {
      if (stores.some((s) => s.name === name)) continue;
      const pg = purgers.filter((p) => p && p.name === name);
      if (!pg.length) { stores.push({ name, status: 'not_verified', detail: 'no purger registered by lead glue; core does not own this store' }); continue; }
      for (const p of pg) {
        try { const r = await p.purge(purgeArg); stores.push({ name, status: r?.status ?? 'not_verified', detail: r?.detail }); }
        catch (e) { stores.push({ name, status: 'not_verified', detail: `purger threw: ${String(e?.message ?? e)}` }); }
      }
    }
    const allVerified = stores.every((s) => s.status === 'verified_deleted' || s.status === 'not_applicable');
    return { scope, at: nowIso(), stores, allVerified };
  }

  async function deleteSession(sessionId) {
    S.deletedSessions.add(sessionId);
    S.gen.data = (S.gen.data ?? 0) + 1;
    const ses = S.sessions.get(sessionId);
    const uttIds = new Set(ses ? ses.utteranceIds : []);
    const texts = [...uttIds].map((id) => S.utterances.get(id)?.text).filter(Boolean);
    const removedMem = new Set();
    for (const m of [...S.memories.values()]) if (m.evidence.some((e) => uttIds.has(e.utteranceId))) { removedMem.add(m.id); S.memories.delete(m.id); }
    for (const m of S.memories.values()) {
      const before = m.meta.history.length;
      m.meta.history = m.meta.history.filter((h) => !h.evidence?.some((e) => uttIds.has(e.utteranceId)) && !removedMem.has(h.by));
      m.meta.pending = m.meta.pending.filter((h) => !h.evidence?.some((e) => uttIds.has(e.utteranceId)) && !removedMem.has(h.by));
      m.supersedes = m.supersedes.filter((x) => !removedMem.has(x));
      if (m.supersededBy && removedMem.has(m.supersededBy)) delete m.supersededBy;
      if (m.meta.pendingUpdateOf && removedMem.has(m.meta.pendingUpdateOf)) delete m.meta.pendingUpdateOf;
      if (m.meta.conflictsWith && removedMem.has(m.meta.conflictsWith)) { delete m.meta.conflictsWith; if (m.when.uncertainty === 'conflicting') m.when.uncertainty = 'stated'; }
      if (before !== m.meta.history.length && ['superseded', 'retracted', 'cancelled'].includes(m.status)) { m.status = statusFromHistory(m); m.revision += 1; }
    }
    let removedProps = 0;
    for (const p of [...S.proposals.values()]) {
      if (p.fields.sourceMemoryIds.some((x) => removedMem.has(x)) || p.evidence.some((e) => uttIds.has(e.utteranceId))) { S.proposals.delete(p.id); removedProps++; }
    }
    for (const id of uttIds) S.utterances.delete(id);
    S.sessions.delete(sessionId);
    syncProposals();
    store.reindexAll(memText);
    const dump = store.dump();
    const remainingTexts = new Set([...S.utterances.values()].map((u) => u.text));
    const leakedText = texts.filter((t) => t.length >= 4 && !remainingTexts.has(t) && dump.includes(JSON.stringify(t).slice(1, -1)));
    const leakedIds = [...uttIds].filter((id) => dump.includes(`"${id}"`));
    const idxLeak = [...S.index.values()].some((set) => [...set].some((d) => uttIds.has(d.slice(4)) || removedMem.has(d.slice(4))));
    const coreStores = [
      { name: 'transcript', status: !S.sessions.has(sessionId) && ![...uttIds].some((id) => S.utterances.has(id)) && !leakedText.length && !leakedIds.length ? 'verified_deleted' : 'not_deleted', detail: `${uttIds.size} utterances removed` },
      { name: 'memories', status: [...S.memories.values()].every((m) => !m.evidence.some((e) => uttIds.has(e.utteranceId))) && !leakedIds.length ? 'verified_deleted' : 'not_deleted', detail: `${removedMem.size} memories removed (any memory with evidence from this session is deleted)` },
      { name: 'search_index', status: idxLeak ? 'not_deleted' : 'verified_deleted', detail: 'index rebuilt from remaining documents' },
      { name: 'proposals', status: [...S.proposals.values()].every((p) => !p.fields.sourceMemoryIds.some((x) => removedMem.has(x))) ? 'verified_deleted' : 'not_deleted', detail: `${removedProps} proposals removed (external actions are the action ledger's responsibility)` },
    ];
    return finishReceipt(`session:${sessionId}`, coreStores, { tag: sessionId, sessionId, utteranceIds: [...uttIds], memoryIds: [...removedMem], all: false });
  }

  async function deleteAll() {
    const counts = { sessions: S.sessions.size, utterances: S.utterances.size, memories: S.memories.size, proposals: S.proposals.size };
    const texts = [...S.utterances.values()].map((u) => u.text);
    for (const id of S.sessions.keys()) S.deletedSessions.add(id);
    S.gen.data = (S.gen.data ?? 0) + 1;
    store.clearAll();
    const dump = store.dump();
    const leaked = texts.filter((t) => t.length >= 4 && dump.includes(JSON.stringify(t).slice(1, -1)));
    const empty = !S.sessions.size && !S.utterances.size && !S.memories.size && !S.proposals.size && !S.index.size && !leaked.length;
    const coreStores = [
      { name: 'transcript', status: empty ? 'verified_deleted' : 'not_deleted', detail: `${counts.utterances} utterances in ${counts.sessions} sessions removed` },
      { name: 'memories', status: empty ? 'verified_deleted' : 'not_deleted', detail: `${counts.memories} memories removed` },
      { name: 'search_index', status: S.index.size === 0 ? 'verified_deleted' : 'not_deleted', detail: 'index cleared' },
      { name: 'proposals', status: S.proposals.size === 0 ? 'verified_deleted' : 'not_deleted', detail: `${counts.proposals} proposals removed` },
    ];
    return finishReceipt('all', coreStores, { all: true });
  }

  // ------------------------------------------------------------------ 2h summary (deterministic)
  function summarizeWindowDeterministic({ fromIso, toIso } = {}) {
    const from = Date.parse(fromIso); const to = Date.parse(toIso);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return err('invalid_window', 'fromIso/toIso must be ISO times with to >= from');
    const inWin = (id) => { const u = S.utterances.get(id); const t = u ? Date.parse(u.startedAt) : NaN; return t >= from && t <= to; };
    const utts = [...S.utterances.values()].filter((u) => { const t = Date.parse(u.startedAt); return t >= from && t <= to; });
    const mems = [...S.memories.values()].filter((m) => m.evidence.some((e) => inWin(e.utteranceId)) || m.meta.history.some((h) => h.evidence?.some((e) => inWin(e.utteranceId))));
    const line = (m) => ({
      memoryId: m.id, status: m.status, text: { ko: `${m.summary.ko}${m.when.value ? ` · ${m.when.value.displayKo}` : ''}${m.where.display ? ` · ${m.where.display}` : ''}`, en: `${m.summary.en}${m.when.value ? ` · ${m.when.value.displayEn}` : ''}${m.where.display ? ` · ${m.where.display}` : ''}` },
      uncertainty: m.when.uncertainty, evidence: clone(verified(m.evidence)),
      ...(m.when.state === 'ambiguous' || m.when.state === 'unknown' || m.where.state === 'unknown' ? { openQuestion: m.when.clarification ?? m.where.clarification } : {}),
    });
    const active = mems.filter((m) => ACTIVE.has(m.status) && !isConstraint(m));
    const sections = {
      appointments: active.filter((m) => m.kind === 'event').map(line),
      tasks: active.filter((m) => m.kind === 'task').map(line),
      people: mems.filter((m) => m.kind === 'person' && ACTIVE.has(m.status)).map(line),
      corrections: mems.filter((m) => ['superseded', 'retracted', 'cancelled'].includes(m.status) || isConstraint(m)).map(line),
      openQuestions: active.filter((m) => m.when.state === 'ambiguous' || m.when.state === 'unknown' || m.when.state === 'partial').map((m) => ({ memoryId: m.id, text: line(m).text, question: m.when.clarification ?? { ko: '언제인가요?', en: 'When is it?' }, evidence: clone(verified(m.evidence)) })),
    };
    return {
      ok: true, fromIso, toIso, mode: 'deterministic', label: 'SIMULATED CLOCK (QA/demo window over synthetic transcript; no background 2h scheduler)',
      sections, stats: { utterances: utts.length, unknownSpeakerUtterances: utts.filter((u) => !u.speakerKnown).length, memories: mems.length },
    };
  }

  // ------------------------------------------------------------------ model-backed 2h digest
  // ADAPTED from bridge digestBlock (E:\jarvis-aside-bridge\server.js L341-406): same idea (summary + schedule + tasks, per-item
  // question/evidence/confidence, "already proposed" list so items are not repeated) with EBYS rules: verbatim evidence, no AM/PM default.
  // The digest is READ-ONLY: it never writes memories. Candidates are returned unsaved; the deterministic sections come from stored memories.
  async function summarizeWindow({ fromIso, toIso, useModel = true } = {}) {
    const base = summarizeWindowDeterministic({ fromIso, toIso });
    if (!base.ok) return base;
    const from = Date.parse(fromIso); const to = Date.parse(toIso);
    const win = [...S.utterances.values()].filter((u) => { const t = Date.parse(u.startedAt); return t >= from && t <= to; });
    base.digest = { mode: 'deterministic' };
    if (win.length < 2) { base.digest = { mode: 'skipped', reason: 'fewer than 2 utterances in the window' }; return base; }
    if (!useModel) return base;
    if (!llm || typeof llm.generateJson !== 'function') { base.digest = { mode: 'fallback', reason: { code: 'no_llm', message: 'no llm injected' }, note: 'FALLBACK: deterministic sections only, no model summary' }; return base; }
    return locked(async () => {
      const g0 = S.gen.data ?? 0; const gl0 = S.gen.global;
      const idxUtts = win.map((u, i) => ({ index: i, speakerKnown: u.speakerKnown, speakerLabel: u.speakerLabel, text: u.text }));
      const ids = win.map((u) => u.id);
      const saved = [...S.memories.values()].slice(-40);
      const savedItems = saved.map((m) => ({ id: m.id, kind: m.kind, title: m.summary.en || m.summary.ko, when: m.when.value?.displayEn ?? null, status: m.status, constraint: m.meta.constraint ?? null }));
      const tags = [...new Set([...win.map((u) => u.sessionId), ...saved.flatMap((m) => m.evidence.map((e) => uttSession(e.utteranceId)))].filter(Boolean))];
      const req = { ...buildDigestRequest({ utterances: idxUtts, savedItems, fromIso, toIso, nowIso: nowIso() }), timeoutMs: llmTimeoutMs, tags };
      let res;
      try { res = await llm.generateJson(req); } catch (e) { res = { ok: false, route: 'unknown', error: { code: 'llm_threw', message: String(e?.message ?? e), retryable: true } }; }
      if ((S.gen.data ?? 0) !== g0 || S.gen.global !== gl0) return err('aborted_by_delete', 'memory was deleted while the model was summarizing; digest discarded');
      const fb = (why) => { base.digest = { mode: 'fallback', reason: why, note: 'FALLBACK: deterministic sections only, no model summary' }; return base; };
      if (!res?.ok) return fb(res?.error ?? { code: 'llm_failed', message: 'no result' });
      const v = validateDigest(res.json, idxUtts, { knownIds: new Set(S.memories.keys()) });
      if (!v.ok) return fb(v.error);
      const lang = S.sessions.get(win[0].sessionId)?.lang ?? 'ko';
      const anchor = win[0].startedAt;
      const summary = v.lines.map((l) => ({ text: { ko: l.ko, en: l.en }, evidence: [evRef(l.loc, ids)] }));
      const fresh = []; const changes = []; let alreadyKnown = 0;
      for (const it of v.items) {
        const evidence = uniqEvidence(it.evidence.map((e) => evRef(e, ids)));
        if (['cancel', 'negation_unavailable', 'replace'].includes(it.cue)) { changes.push({ cue: it.cue, title: it.title, target: it.target, evidence }); continue; }
        if (it.kind !== 'event' && it.kind !== 'task') continue;
        const slots = slotsFromItem(it, ids, lang, anchor);
        const c = mergeParts(slots.parts); const who = it.who.map((w) => w.name);
        const known = saved.find((m) => m.kind === it.kind && ACTIVE.has(m.status) && !isConstraint(m) && (!c.matched || dateCompat(m, c).compatible) && threadScore(m, it, who, it.title) > 0.3);
        if (known) { alreadyKnown++; continue; }
        fresh.push({ kind: it.kind, type: it.type, owner: it.owner, cue: it.cue, title: it.title, who: slots.who, when: slots.when, where: slots.where, question: it.question, missing: it.missing, confidence: it.confidence, evidence, saved: false });
      }
      base.digest = {
        mode: 'model', route: { id: res.route, model: res.model, cached: !!res.cached, ms: res.ms }, summary, candidates: fresh, alreadyKnown, observedChanges: changes,
        rejected: v.rejected, rejectedDetail: v.rejectedDetail, note: 'Candidates are NOT saved as memories; ingest the transcript to save them. Summary lines are model prose, each linked to a verbatim quote.',
      };
      return base;
    });
  }

  // ------------------------------------------------------------------ request classifier
  // ADAPTED from bridge classifyIntent (E:\jarvis-aside-bridge\server.js L408-434): event|task|other -> event|task|question.
  // EBYS: question = evidence-linked recall (core.query); never a generic agent. No '1-7시 = 오후' default; times stay ambiguous.
  const Q_RE = /[?？]\s*$|언제|어디|누구|누가|뭐였|뭐야|무엇|몇\s*시|며칠|알려\s*줘|기억|\bwhen\b|\bwhere\b|\bwho\b|\bwhat\b|\bwhich\b|\bhow (?:many|much|long|soon)\b|\bdid (?:i|we|he|she|they)\b|\bdo (?:i|you|we) (?:have|know|remember)\b|\bdo you remember\b|\bhave i\b|\bis there\b|\btell me\b|\bremind me (?:when|where|what|who)\b|\bwhose\b/i;
  const EVENT_RE = /예약|약속|일정|잡아|넣어|만나|모임|appointment|schedule|meeting|\bbook\b|\badd\b|\blunch\b|\bdinner\b|\bbreakfast\b|\bbrunch\b|\bcoffee\b|\blesson\b|\bclass\b|\bparty\b|\bvisit\b|\breserv\w*|get-?together|\bplan\b|\bmeet\b/i;
  const TASK_RE = /해야|[가-힣]야\s*(?:해|돼|된다|한다|하)|할\s*일|사야|사기|보내야|전화해야|챙겨|잊지|remind me to|need to|have to|\bmust\b|don'?t forget|remember to|pick up|\bbring\b|to-?do|\bbuy\b|\bcall\b|\brenew\b|\brefill\b|\bpay\b|\bshould\b/i;
  function fallbackClassify(text) {
    const spans = scanTimePhrases(text);
    const imperative = /잡아|넣어|추가|등록|\badd\b|\bschedule\b|\bbook\b|\bput\b|\bset up\b|\bcreate\b|\bremind me to\b|\bplease (?:add|put|book|schedule|set)\b|\bcan you (?:add|put|book|schedule)\b/i.test(text);
    let kind = 'question'; let unclear = false;
    if (Q_RE.test(text) && !imperative) kind = 'question';
    else if (EVENT_RE.test(text) && spans.length) kind = 'event';
    else if (TASK_RE.test(text)) kind = 'task';
    else if (EVENT_RE.test(text)) kind = 'event';
    else unclear = true;
    return { ok: true, kind, title: text.trim().slice(0, 60), whenQuote: spans.length ? text.slice(spans[0].start, spans[spans.length - 1].end) : null, whereQuote: null, dueQuote: null, detail: null, unclear, rejected: 0, rejectedDetail: [] };
  }
  async function classifyRequest(text, { lang = 'en' } = {}) {
    if (typeof text !== 'string' || !text.trim()) return err('empty_text', 'request text is empty');
    const anchor = nowIso();
    let v = null; let mode = 'model'; let route = null; let fallbackReason = null;
    if (llm && typeof llm.generateJson === 'function') {
      const res = await locked(async () => {
        try { return await llm.generateJson({ ...buildClassifyRequest(text, anchor), timeoutMs: Math.min(llmTimeoutMs, 60000), tags: ['request'] }); }
        catch (e) { return { ok: false, route: 'unknown', error: { code: 'llm_threw', message: String(e?.message ?? e), retryable: true } }; }
      });
      if (res?.ok) { const cv = validateClassify(res.json, text); if (cv.ok) { v = cv; route = { id: res.route, model: res.model, cached: !!res.cached, ms: res.ms }; } else fallbackReason = cv.error; }
      else fallbackReason = res?.error ?? { code: 'llm_failed', message: 'no result' };
    } else fallbackReason = { code: 'no_llm', message: 'no llm injected' };
    if (!v) { v = fallbackClassify(text); mode = 'fallback'; route = { id: 'fallback-rules', model: 'rules', error: fallbackReason }; }
    const srcRef = (q) => { const i = text.indexOf(q); return { quote: q, charStart: i, charEnd: i + q.length, source: 'request_text_not_stored' }; };
    const when = v.whenQuote ? buildWhenSlot([parseTimePhrase(v.whenQuote, anchor)], { evidence: [], lang }) : unknownSlot({ ko: '언제인가요?', en: 'When is it?' });
    if (v.whenQuote) when.sourceQuote = srcRef(v.whenQuote);
    const due = v.dueQuote ? buildWhenSlot([parseTimePhrase(v.dueQuote, anchor)], { evidence: [], lang }) : unknownSlot({ ko: '언제까지인가요?', en: 'Due when?' });
    if (v.dueQuote) due.sourceQuote = srcRef(v.dueQuote);
    const where = v.whereQuote ? { state: 'known', value: { name: v.whereQuote }, display: v.whereQuote, uncertainty: 'stated', evidence: [], sourceQuote: srcRef(v.whereQuote) } : unknownSlot({ ko: '어디인가요?', en: 'Where is it?' });
    const out = {
      ok: true, kind: v.kind, title: v.title ?? text.trim().slice(0, 60), slots: { when, where, due }, detail: v.detail, unclear: v.unclear, mode, route,
      rejected: v.rejected, rejectedDetail: v.rejectedDetail, next: v.kind === 'question' ? 'recall' : 'propose',
      needsClarification: v.kind === 'event' && when.state !== 'known',
    };
    if (mode === 'fallback') out.fallbackNote = 'FALLBACK: keyword rules, no model';
    return out;
  }
  // ------------------------------------------------------------------ fixtures (test/demo convenience; same pipeline)
  async function ingestFixture(fixtureId) {
    if (!/^[a-z0-9-]+$/.test(String(fixtureId))) return err('bad_fixture_id', 'fixture id must match [a-z0-9-]+');
    let fx;
    try { fx = JSON.parse(readFileSync(new URL(`./fixtures/${fixtureId}.json`, import.meta.url), 'utf8')); }
    catch { return err('fixture_not_found', `no fixture ${fixtureId}`); }
    const r = await ingestText({ title: fx.title, text: fx.text, lang: fx.lang, provenance: 'synthetic' });
    return r.ok ? { ...r, fixtureId } : r;
  }

  return {
    ingestText, ingestFixture, getTranscript, listMemories, getMemory, query,
    propose, updateProposal, cancelProposal, markConfirmed, validateForExecution, resolvePending, getProposal, findDuplicates, setActionRecord,
    getStorageSummary, deleteSession, deleteAll, summarizeWindow, summarizeWindowDeterministic, classifyRequest, setPaused,
    _store: store, _tz: TZ,
  };
}
