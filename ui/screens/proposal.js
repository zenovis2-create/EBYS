// A4 Proposal -> clarify (mandatory AM/PM) -> edit -> confirm readback -> result
import { h } from '../lib/dom.js';
import { t, pick, getLang } from '../i18n.js';
import { state, app, go, rerender, trackProposal } from '../store.js';
import { Btn, ErrorBox, StateBadge, UncBadge, openEvidence, ReadAloud, autoSpeak, langOf, TzNote } from '../components.js';
import { runWithProgress } from '../progress.js';
import { displayState } from '../lib/contracts.js';
import { parseIso, composeIso, isDateOnly, formatDate, formatTime, formatWhen, offsetLabel } from '../lib/time.js';
import { normalizePreview } from '../lib/preview.js';

const STEP_NO = { review: 1, form: 2, confirm: 3, result: 4, cancelled: 4 };

function current() {
  const f = state.flow;
  if (!f) return null;
  const e = state.plans.get(f.proposalId);
  return e ? { f, e, p: e.proposal } : null;
}

export function proposalBadgeKey(entry) {
  if (entry.record) return displayState(entry.record);
  return entry.proposal.state === 'user_confirmed' ? 'user_confirmed' : entry.proposal.state;
}

// ---- rows used by readback (person, date, time, action are always shown) ----
export function readbackRows({ fields, preview, record }) {
  const lang = getLang();
  const src = record?.readback ?? preview ?? fields;
  const startsAt = src.startsAt ?? fields.startsAt;
  const unknown = t('slot.unknown');
  const kind = (preview?.kind ?? fields.kind) === 'todo' ? t('a4.actionTodo') : t('a4.actionAppt');
  const rem = (src.reminders ?? fields.remindOffsetsMin ?? []).map((m) => offsetLabel(m, lang)).join(', ');
  return [
    ['a4.rbPerson', src.who ?? fields.who ?? unknown, !(src.who ?? fields.who)],
    ['a4.rbDate', formatDate(startsAt, lang) ?? unknown, !formatDate(startsAt, lang)],
    ['a4.rbTime', formatTime(startsAt, lang) ?? unknown, !formatTime(startsAt, lang)],
    ['a4.rbTz', t('tz.seoul'), false],
    ['a4.rbPlace', src.where ?? fields.where ?? unknown, !(src.where ?? fields.where)],
    ['a4.rbAction', rem ? `${kind} + ${t('a4.fieldReminders')}: ${rem}` : kind, false],
  ];
}

function RowsTable(rows) {
  return h('dl', { class: 'readback' }, rows.map(([k, v, unk]) => h('div', { class: 'rb-row' },
    h('dt', null, t(k)), h('dd', { class: unk ? 'slot-unknown-inline' : '' }, v))));
}

function Steps(step) {
  const n = STEP_NO[step] ?? 1;
  return h('ol', { class: 'steps', 'aria-label': t('a4.title') },
    ['a4.step1', 'a4.step2', 'a4.step3', 'a4.step4'].map((k, i) => h('li', { class: i + 1 === n ? 'step-on' : '', 'aria-current': i + 1 === n ? 'step' : null }, t(k))));
}

// ---- notification preview (never claims a real notification) ----
export function NotificationPreview(fields, preview) {
  const lang = getLang();
  const src = preview ?? fields;
  const starts = src.startsAt ?? fields.startsAt;
  const offsets = src.reminders ?? fields.remindOffsetsMin ?? [];
  const d = starts ? new Date(starts) : null;
  // Prefer the server-built bilingual notification previews; otherwise compute from the reminder offsets.
  const server = Array.isArray(src.notifications) && src.notifications.length ? src.notifications : null;
  const items = server
    ? server.map((n) => ({ label: n.badge ? pick(n.badge) : '', when: n.fireAt ? `${formatWhen(n.fireAt, lang) ?? ''}` : '', body: pick(n.body) || t('notif.body', { when: formatWhen(starts, lang), title: pick(n.title) || src.title }), title: pick(n.title) }))
    : (d && !Number.isNaN(d.getTime()) ? offsets : []).map((m) => ({
      label: offsetLabel(m, lang), when: formatWhen(new Date(d.getTime() - m * 60000).toISOString(), lang),
      body: t('notif.body', { when: formatWhen(starts, lang), title: src.title ?? fields.title }),
    }));
  return h('div', { class: 'card notif' },
    h('h3', null, t('notif.title')),
    h('p', { class: 'note note-fixture' }, t('notif.note'), ' ', t('tz.short')),
    items.length ? items.map((i) => h('div', { class: 'notif-card' },
      h('div', { class: 'small' }, i.label, i.label && i.when ? ' · ' : '', i.when),
      h('div', { class: 'notif-body', lang: langOf(i.body) }, i.body),
      h('div', { class: 'row' }, h('span', { class: 'fake-btn' }, t('notif.ok')), h('span', { class: 'fake-btn' }, t('notif.later')))))
      : h('p', { class: 'small' }, t('slot.unknown')));
}

// ---- step 1: review ----
function ProposalCard(c) {
  const { p, e } = c;
  const lang = getLang();
  const key = proposalBadgeKey(e);
  const rows = readbackRows({ fields: p.fields, preview: null, record: null });
  return h('div', { class: `card statecard st-${key}` },
    h('div', { class: 'mem-head' }, StateBadge(key)),
    h('h2', null, p.fields.title),
    key === 'proposed' || key === 'needs_info' ? h('p', { class: 'note' }, t('a4.proposedNote')) : null,
    p.state === 'needs_info' || (p.missing ?? []).length ? h('p', { class: 'warn-strong' }, t('a4.needsInfo')) : null,
    RowsTable(rows),
    p.slotUncertainty?.when ? h('p', null, t('slot.when'), ': ', UncBadge(p.slotUncertainty.when)) : null,
    (p.evidence ?? []).length ? Btn(`${t('a4.why')} · ${p.evidence.length}`, () => openEvidence(p.evidence), { variant: 'link' }) : h('p', { class: 'warn' }, t('a2.noEvidence')),
    p.readback ? h('p', { class: 'small' }, pick(p.readback)) : null);
}

function ReviewStep(c) {
  const { p, f } = c;
  const closed = ['cancelled', 'expired'].includes(p.state);
  const needs = p.state === 'needs_info' || (p.missing ?? []).length > 0;
  return h('div', null,
    ProposalCard(c),
    p.duplicateOf ? h('div', { class: 'note', role: 'alert' }, h('strong', null, t('a4.dup')), ' ', Btn(t('a4.dupView'), () => go('plans'), { variant: 'link' })) : null,
    ErrorBox(f.error, { onDismiss: () => { f.error = null; rerender(); } }),
    f.note ? h('p', { class: 'note' }, f.note) : null,
    f.confirmCancel
      ? h('div', { class: 'card', role: 'alertdialog', 'aria-label': t('a4.cancelAsk') },
        h('p', null, t('a4.cancelAsk')),
        h('div', { class: 'stack' }, Btn(t('a4.cancelNo'), () => { f.confirmCancel = false; rerender(); }, { variant: 'primary' }), Btn(t('a4.cancelYes'), () => doCancel(c), { variant: 'danger' })))
      : h('div', { class: 'stack' },
        p.duplicateOf ? null
          : needs ? Btn(t('a4.clarifyTitle'), () => toForm(c, 'clarify'), { variant: 'primary' })
            : Btn(t('a4.review'), () => toConfirm(c), { variant: 'primary', disabled: closed }),
        needs ? null : Btn(t('a4.edit'), () => toForm(c, 'edit')),
        Btn(t('a4.cancel'), () => { f.confirmCancel = true; rerender(); }, { variant: 'danger' })));
}

async function doCancel(c) {
  const res = await runWithProgress('prog.save', (signal) => app.api.cancelProposal(c.p.id, { signal }));
  if (!res.ok) { c.f.error = res.error; c.f.confirmCancel = false; return rerender(); }
  trackProposal(res.data);
  c.f.confirmCancel = false;
  c.f.step = 'cancelled';
  rerender();
}

// ---- step 2: form (clarify = time only, mandatory AM/PM; edit = all fields) ----
function toForm(c, mode) {
  const { p, f } = c;
  const fl = p.fields;
  const parsed = parseIso(fl.startsAt);
  const mem = state.memories.find((m) => m.id === fl.sourceMemoryIds?.[0]);
  const seed = whenSeed(mem?.when);
  f.form = {
    mode,
    date: parsed?.date ?? seed.date ?? '',
    hour12: parsed ? parsed.hour12 : (seed.time?.hour12 ?? ''),
    minute: parsed ? parsed.minute : (seed.time?.minute ?? ''),
    ampm: parsed ? parsed.ampm : (seed.time?.ampm ?? null),
    title: fl.title ?? '', who: fl.who ?? '', where: fl.where ?? '',
    remDay: (fl.remindOffsetsMin ?? []).includes(1440), remHour: (fl.remindOffsetsMin ?? []).includes(60),
    missing: [],
  };
  f.step = 'form'; f.error = null; f.note = null;
  rerender();
}

const parseHm = (hm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm ?? '');
  if (!m) return null;
  const H = Number(m[1]);
  return { hour12: H % 12 || 12, minute: Number(m[2]), ampm: H >= 12 ? 'pm' : 'am' };
};
const timeOfIso = (iso) => { const p = parseIso(iso); return p ? { hour12: p.hour12, minute: p.minute, ampm: p.ampm } : null; };

/** Date/time already stated in a memory's `when` slot. Accepts the core's object value ({date,time,startIso}) or a legacy string. */
export function whenSeed(when) {
  const v = when?.value;
  if (typeof v === 'string') return { date: isDateOnly(v.slice(0, 10)) ? v.slice(0, 10) : null, time: timeOfIso(v) };
  if (v && typeof v === 'object') {
    return { date: isDateOnly(v.date) ? v.date : (parseIso(v.startIso)?.date ?? null), time: v.startIso ? timeOfIso(v.startIso) : parseHm(v.time) };
  }
  return { date: null, time: null };
}

/**
 * Candidate options from a memory's when.candidates. Accepts BOTH legacy ISO strings and the core's objects
 * { date, time, startIso, labelKo, labelEn } (any of date/time/startIso may be null for partial candidates).
 * Returns [{ key, label, date, time:{hour12,minute,ampm}|null }].
 */
export function candidateOptions(cands, lang = getLang()) {
  const out = [];
  for (const c of cands ?? []) {
    let o = null;
    if (typeof c === 'string') {
      const p = parseIso(c);
      if (p) o = { key: c, label: formatWhen(c, lang) ?? c, date: p.date, time: timeOfIso(c) };
      else if (isDateOnly(c)) o = { key: c, label: formatDate(c, lang) ?? c, date: c, time: null };
    } else if (c && typeof c === 'object') {
      const p = c.startIso ? parseIso(c.startIso) : null;
      const date = isDateOnly(c.date) ? c.date : (p?.date ?? null);
      const time = p ? timeOfIso(c.startIso) : parseHm(c.time);
      const named = lang === 'ko' ? (c.labelKo ?? c.labelEn) : (c.labelEn ?? c.labelKo);
      const label = named || (c.startIso ? formatWhen(c.startIso, lang) : '') || [date ? formatDate(date, lang) : '', c.time ?? ''].filter(Boolean).join(' ');
      if (label && (date || time)) o = { key: c.startIso ?? `${c.date ?? ''}|${c.time ?? ''}`, label, date, time };
    }
    if (o && !out.some((x) => x.key === o.key)) out.push(o);
  }
  return out;
}

function candidatesFor(p) {
  const mem = state.memories.find((m) => m.id === p.fields.sourceMemoryIds?.[0]);
  return candidateOptions(mem?.when?.candidates, getLang());
}

function FormStep(c) {
  const { p, f } = c;
  const form = f.form;
  const lang = getLang();
  const cands = candidatesFor(p);
  const opt = (value, label, selected) => h('option', { value: String(value), selected }, label);
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), ...(form.minute === '' ? [] : [form.minute])])].sort((a, b) => a - b);
  const sel = (id, labelKey, options, onChange) => h('div', { class: 'field-group' },
    h('label', { for: id, class: 'label' }, t(labelKey)),
    h('select', { id, class: 'field', onChange }, options));
  const ampmBtn = (val, key) => h('button', {
    type: 'button', class: `btn btn-toggle ${form.ampm === val ? 'btn-on' : ''}`, 'aria-pressed': String(form.ampm === val),
    onClick: () => { form.ampm = val; rerender(); },
  }, t(key));
  return h('div', null,
    h('h2', null, form.mode === 'clarify' ? t('a4.clarifyTitle') : t('a4.edit')),
    form.mode === 'clarify' ? h('p', { class: 'lead' }, t('a4.clarifyLead')) : null,
    TzNote({ compact: true }),
    f.note ? h('p', { class: 'note', role: 'alert' }, f.note) : null,
    cands.length ? h('div', null, h('p', { class: 'label' }, t('a4.candidates')),
      h('div', { class: 'chips chips-wrap' }, cands.map((cd) => h('button', {
        type: 'button', class: 'chip', onClick: () => {
          // The chip label itself states AM/PM, so tapping it is the person's explicit choice.
          // A candidate without a time leaves hour/minute/AM-PM untouched (never defaulted).
          if (cd.date) form.date = cd.date;
          if (cd.time) { form.hour12 = cd.time.hour12; form.minute = cd.time.minute; form.ampm = cd.time.ampm; }
          rerender();
        },
      }, cd.label)))) : null,
    form.mode === 'edit' ? h('div', null,
      h('label', { for: 'f-title', class: 'label' }, t('a4.fieldTitle')),
      h('input', { id: 'f-title', class: 'field', type: 'text', value: form.title, onInput: (e) => { form.title = e.target.value; } }),
      h('label', { for: 'f-who', class: 'label' }, t('a4.fieldWho')),
      h('input', { id: 'f-who', class: 'field', type: 'text', value: form.who, onInput: (e) => { form.who = e.target.value; } }),
      h('label', { for: 'f-where', class: 'label' }, t('a4.fieldWhere')),
      h('input', { id: 'f-where', class: 'field', type: 'text', value: form.where, onInput: (e) => { form.where = e.target.value; } })) : null,
    p.fields.kind === 'todo' && form.mode === 'edit' ? null : h('div', null,
      h('label', { for: 'f-date', class: 'label' }, t('a4.fieldDate')),
      h('input', { id: 'f-date', class: 'field', type: 'date', value: form.date, onChange: (e) => { form.date = e.target.value; } }),
      h('div', { class: 'row-time' },
        sel('f-hour', 'a4.hour', [opt('', '—', form.hour12 === ''), ...Array.from({ length: 12 }, (_, i) => opt(i + 1, String(i + 1), form.hour12 === i + 1))],
          (e) => { form.hour12 = e.target.value === '' ? '' : Number(e.target.value); }),
        sel('f-min', 'a4.minute', [opt('', '—', form.minute === ''), ...minutes.map((m) => opt(m, String(m).padStart(2, '0'), form.minute === m))],
          (e) => { form.minute = e.target.value === '' ? '' : Number(e.target.value); })),
      h('div', { role: 'group', 'aria-labelledby': 'ampm-label' },
        h('p', { id: 'ampm-label', class: 'label' }, t('a4.ampm'), ' *'),
        h('div', { class: 'row' }, ampmBtn('am', 'a4.am'), ampmBtn('pm', 'a4.pm')))),
    form.mode === 'edit' ? h('fieldset', { class: 'choices' }, h('legend', null, t('a4.fieldReminders')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: form.remDay, onChange: (e) => { form.remDay = e.target.checked; } }), h('span', null, t('a4.reminderDay'))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: form.remHour, onChange: (e) => { form.remHour = e.target.checked; } }), h('span', null, t('a4.reminderHour')))) : null,
    form.missing.length ? h('p', { class: 'errorbox', role: 'alert' }, form.missing.map((k) => t(k)).join(' · ')) : null,
    ErrorBox(f.error, { onDismiss: () => { f.error = null; rerender(); } }),
    h('div', { class: 'stack' },
      Btn(t('a4.saveChanges'), () => saveForm(c), { variant: 'primary' }),
      form.mode === 'clarify' ? Btn(t('a4.unknownLater'), () => { f.step = 'review'; f.note = t('a4.unknownLaterNote'); rerender(); }) : null,
      Btn(t('a4.cancelNo'), () => { f.step = 'review'; rerender(); })));
}

async function saveForm(c) {
  const { p, f } = c;
  const form = f.form;
  const isTodoEdit = p.fields.kind === 'todo' && form.mode === 'edit';
  const patch = {};
  if (!isTodoEdit) {
    const missing = [];
    if (!isDateOnly(form.date)) missing.push('a4.missingDate');
    if (form.hour12 === '') missing.push('a4.missingHour');
    if (form.minute === '') missing.push('a4.missingMinute');
    if (form.ampm !== 'am' && form.ampm !== 'pm') missing.push('a4.missingAmpm'); // mandatory: never defaulted
    form.missing = missing;
    if (missing.length) return rerender();
    patch.startsAt = composeIso(form);
  }
  if (form.mode === 'edit') {
    if (form.title.trim()) patch.title = form.title.trim();
    if (form.who.trim()) patch.who = form.who.trim();
    if (form.where.trim()) patch.where = form.where.trim();
    patch.remindOffsetsMin = [form.remDay ? 1440 : null, form.remHour ? 60 : null].filter((x) => x != null);
  }
  const res = await runWithProgress('prog.save', (signal) => app.api.updateProposal(p.id, patch, { signal }));
  if (!res.ok) { f.error = res.error; return rerender(); }
  trackProposal(res.data, { preview: null, previewDigest: null, record: null });
  await toConfirm({ ...c, p: res.data, e: state.plans.get(p.id) });
}

// ---- step 3: confirm readback ----
async function toConfirm(c) {
  const { f } = c;
  f.error = null; f.note = null;
  const res = await runWithProgress('prog.preview', (signal) => app.api.preview({ proposalId: c.p.id }, { signal }));
  if (!res.ok) { f.step = 'review'; f.error = res.error; return rerender(); }
  const d = res.data;
  if (d.needs_clarification || d.preview?.needs_clarification) {
    toForm({ ...c, p: state.plans.get(c.p.id).proposal }, 'clarify');
    const prompt = d.needs_clarification?.prompt ?? d.preview?.prompt;
    f.note = prompt && typeof prompt === 'object' ? `${t('a4.clarifyAgain')} ${pick(prompt)}` : t('a4.clarifyAgain');
    return rerender();
  }
  const pv = normalizePreview(d);
  trackProposal(state.plans.get(c.p.id).proposal, { preview: pv, previewDigest: pv.previewDigest, previewMeta: { mode: pv.mode, adapterId: pv.adapterId, modeLabel: pv.modeLabel } });
  f.step = 'confirm';
  const entry = state.plans.get(c.p.id);
  autoSpeak('readback', readbackSpeech(readbackRows({ fields: entry.proposal.fields, preview: entry.preview, record: null })));
  rerender();
}

/** Spoken readback = the same person/date/time/place/action rows that are shown on screen (text is never replaced by voice). */
export function readbackSpeech(rows) {
  return `${rows.map(([k, v]) => `${t(k)}: ${v}`).join('. ')}. ${t('rb.speakNoCalls')}`;
}

function modeLine(e) {
  const m = e.previewMeta ?? {};
  if (m.modeLabel) return pick(m.modeLabel);
  if (m.mode === 'real') return t('a4.modeReal', { name: m.adapterId ?? '?' });
  if (m.mode === 'handoff' || String(m.adapterId ?? '').includes('ics')) return t('a4.modeFile');
  return t('a4.modeSim');
}

function ConfirmStep(c) {
  const { p, e, f } = c;
  const rows = readbackRows({ fields: p.fields, preview: e.preview, record: null });
  return h('div', null,
    h('h2', null, t('a4.confirmTitle')),
    h('div', { class: `card statecard st-proposed` }, StateBadge('proposed'), RowsTable(rows),
      p.readback ? h('p', { class: 'readback-sentence' }, pick(p.readback)) : null),
    h('p', { class: 'note note-fixture' }, modeLine(e)),
    (e.preview?.warnings ?? []).length ? h('div', { class: 'note', role: 'note' }, h('strong', null, t('a4.warnings')),
      h('ul', null, e.preview.warnings.map((w) => h('li', null, w.message ? pick(w.message) : t(`a4.warn.${w.code}`))))) : null,
    e.preview?.duplicateOf ? h('div', { class: 'note', role: 'alert' }, h('strong', null, t('a4.dup'))) : null,
    ErrorBox(f.error, { onDismiss: () => { f.error = null; rerender(); } }),
    h('div', { class: 'stack actionzone' },
      Btn(f.confirming ? t('a4.working') : t('a4.yes'), () => doConfirm(c), { variant: 'primary', disabled: f.confirming }),
      Btn(t('a4.back'), () => toForm(c, 'edit'), { disabled: f.confirming })),
    ReadAloud('readback', () => readbackSpeech(rows)),
    h('p', { class: 'note' }, t('a4.noCalls')),
    TzNote(),
    h('div', { class: 'stack' },
      Btn(t('a4.cancel'), () => { f.step = 'review'; f.confirmCancel = true; rerender(); }, { variant: 'danger', disabled: f.confirming })));
}

async function doConfirm(c) {
  const { p, e, f } = c;
  if (f.confirming) return; // double-tap guard (server is also idempotent on proposal id + revision)
  f.confirming = true; f.error = null;
  rerender();
  const res = await runWithProgress('prog.confirm', (signal) => app.api.confirm({ proposalId: p.id, previewDigest: e.previewDigest }, { signal }));
  f.confirming = false;
  if (!res.ok) {
    f.error = res.error;
    if (res.error.code === 'stale_preview') return toConfirm(c);
    return rerender();
  }
  const rec = res.data?.record ?? res.data;
  const proposal = res.data?.proposal ?? state.plans.get(p.id).proposal;
  trackProposal(proposal, { record: rec });
  f.step = 'result'; f.showNotif = false;
  rerender();
}

// ---- step 4: result (driven by displayState) ----
function ResultStep(c) {
  const { p, e, f } = c;
  const rec = e.record;
  const key = displayState(rec);
  const err = rec?.error;
  const success = key === 'completed_external';
  const rows = readbackRows({ fields: p.fields, preview: e.preview, record: success ? rec : null });
  const canRetry = (key === 'failed' || key === 'permission_denied') && err?.phase !== 'post_send' && err?.retryable !== false;
  const blocked = key === 'unknown_outcome' || key === 'verify_mismatch';
  const done = ['completed_external', 'simulated_completed', 'handed_off', 'user_attested'].includes(key);
  const verifiedAt = rec?.timestamps?.verifiedAt;
  return h('div', null,
    h('h2', null, t('a4.resultTitle')),
    h('div', { class: `card statecard st-${key}`, role: success ? 'status' : (key === 'failed' || key === 'permission_denied' || blocked ? 'alert' : 'status') },
      h('div', { class: 'state-big' }, StateBadge(key)),
      success ? h('p', { class: 'small' }, t('a4.readbackBasis'), verifiedAt ? ` ${t('a4.verifiedAt', { t: formatWhen(verifiedAt, getLang()) })}` : '')
        : h('p', { class: 'small' }, t('a4.previewBasis')),
      RowsTable(rows),
      rec?.readbackText ? h('p', { class: 'readback-sentence' }, pick(rec.readbackText)) : null,
      err ? h('p', { class: 'warn-strong' }, pick(err.userHint) || err.message) : null,
      key === 'permission_denied' ? h('p', null, t('a4.permHint')) : null,
      blocked || key === 'handed_off' || key === 'user_attested' ? h('p', { class: 'note' }, t('a4.checkCalendar')) : null,
      blocked ? h('p', { class: 'warn-strong' }, t('a4.retryBlocked')) : null),
    h('div', { class: 'stack' },
      canRetry ? Btn(t('a4.retry'), () => { f.step = 'confirm'; return doConfirm(c); }, { variant: 'primary' }) : null,
      done ? Btn(t('a4.previewNotif'), () => { f.showNotif = !f.showNotif; rerender(); }, { variant: 'primary' }) : null,
      Btn(t('a4.toPlans'), () => go('plans')),
      key === 'failed' || key === 'permission_denied' ? Btn(t('a4.cancel'), () => { f.step = 'review'; f.confirmCancel = true; rerender(); }, { variant: 'danger' }) : null),
    done && f.showNotif ? NotificationPreview(p.fields, e.preview) : null);
}

function CancelledStep(c) {
  const inflight = Boolean(c.e.record);
  return h('div', { class: 'card statecard st-cancelled' }, StateBadge('cancelled'),
    h('p', null, inflight ? t('a4.cancelledInflight') : t('a4.cancelledNote')),
    Btn(t('a4.toPlans'), () => go('plans'), { variant: 'primary' }));
}

export function renderProposal() {
  const c = current();
  const title = h('h1', { id: 'screen-title', tabindex: '-1' }, t('a4.title'));
  if (!c) return h('section', { 'aria-labelledby': 'screen-title' }, title, h('p', null, state.flow ? t('a4.proposalGone') : t('a4.noFlow')), Btn(t('nav.memory'), () => go('memories'), { variant: 'primary' }));
  const body = { review: ReviewStep, form: FormStep, confirm: ConfirmStep, result: ResultStep, cancelled: CancelledStep }[c.f.step] ?? ReviewStep;
  return h('section', { 'aria-labelledby': 'screen-title' }, title, Steps(c.f.step), body(c));
}

/** Used by Plans: reopen an existing tracked proposal at the right step. */
export function reopenProposal(proposalId) {
  const e = state.plans.get(proposalId);
  if (!e) return;
  state.flow = { proposalId, step: e.record ? 'result' : 'review', form: null, error: null, confirming: false, showNotif: false };
  go('proposal');
}
