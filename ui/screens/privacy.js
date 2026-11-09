// A6 Privacy / delete receipt + static capability/roadmap list
import { h } from '../lib/dom.js';
import { t, getLang, setLang } from '../i18n.js';
import { state, app, rerender, resetData } from '../store.js';
import { Btn, ErrorBox, TzNote, modelChipInfo } from '../components.js';
import { runWithProgress } from '../progress.js';
import { CAPABILITIES } from '../capabilities.js';
import { savePrefs } from '../lib/prefs.js';
import { ttsAvailable, speak, stopSpeaking, speechLang } from '../lib/speech.js';

function Toggle(label, on, onClick, attrs = {}) {
  return h('button', { type: 'button', class: `btn btn-toggle ${on ? 'btn-on' : ''}`, 'aria-pressed': String(on), onClick, ...attrs }, label);
}

function SettingsCard() {
  const lang = getLang();
  const setL = (l) => { setLang(l); savePrefs({ lang: l, scale: state.scale }); rerender(); };
  const setS = (s) => { state.scale = s; savePrefs({ lang: getLang(), scale: s }); rerender(); };
  const m = modelChipInfo();
  return h('div', { class: 'card settings' },
    h('h2', null, t('settings.title')),
    h('div', { role: 'group', 'aria-labelledby': 'set-lang' },
      h('p', { id: 'set-lang', class: 'label' }, t('settings.lang')),
      h('div', { class: 'seg' }, Toggle(t('settings.langEn'), lang === 'en', () => setL('en'), { lang: 'en' }), Toggle(t('settings.langKo'), lang === 'ko', () => setL('ko'), { lang: 'ko' })),
      h('p', { class: 'small' }, t('hdr.langNote'))),
    h('div', { role: 'group', 'aria-labelledby': 'set-size' },
      h('p', { id: 'set-size', class: 'label' }, t('hdr.size')),
      h('div', { class: 'seg' }, [[1, 'hdr.size100'], [1.25, 'hdr.size125'], [1.5, 'hdr.size150']].map(([s, k]) => Toggle(t(k), state.scale === s, () => setS(s))))),
    ttsAvailable() ? h('div', null,
      h('p', { class: 'label' }, t('voice.toggle')),
      Toggle(`${t('voice.toggle')}: ${state.voiceOn ? t('voice.on') : t('voice.off')}`, state.voiceOn, () => {
        state.voiceOn = !state.voiceOn;
        if (state.voiceOn) speak(`${t('voice.toggle')} ${t('voice.on')}`, getLang()); else stopSpeaking();
        rerender();
      }),
      h('p', { class: 'small' }, t('cap.speechLang', { l: speechLang(lang) }))) : h('p', { class: 'small' }, t('voice.unavailable')),
    h('p', { class: 'label' }, t('settings.model')),
    h('p', null, h('span', { class: `statuschip ${m.cls}` }, m.text), ' ',
      h('span', { class: `statuschip ${app.apiKind === 'live' ? 'chip-live' : 'chip-fixture'}` }, t(app.apiKind === 'live' ? 'chip.api.live' : 'chip.api.fixture')), ' ',
      h('span', { class: 'statuschip chip-data' }, t(state.provenance === 'consented' ? 'chip.data.consented' : 'chip.data.synthetic'))),
    h('p', { class: 'label' }, t('tz.label')), TzNote());
}

async function doDelete(scope) {
  const args = scope === 'all' ? { all: true } : { sessionId: state.sessions.at(-1)?.sessionId };
  const res = await runWithProgress('prog.delete', (signal) => app.api.remove(args, { signal }));
  state.confirmDelete = null;
  if (!res.ok) { state.receipt = null; state.privError = res.error; return rerender(); }
  state.privError = null;
  state.receipt = res.data;
  // Only the data the server reports as deleted leaves the UI; nothing else is claimed.
  resetData(scope === 'all' ? { all: true } : { sessionId: args.sessionId });
  rerender();
}

function Receipt(r) {
  const stores = r.stores ?? [];
  // Defensive: the strong headline needs the server's flag AND every store verified/not applicable.
  const strong = r.allVerified === true && stores.every((s) => s.status === 'verified_deleted' || s.status === 'not_applicable');
  return h('div', { class: 'card', role: 'status' },
    h('h2', null, t('a6.receipt')),
    h('p', { class: strong ? 'ok-strong' : 'warn-strong' }, strong ? t('a6.allVerified') : t('a6.partial')),
    h('ul', { class: 'receipt' }, stores.map((s) => h('li', { class: `rc rc-${s.status}` },
      h('span', { class: 'rc-name' }, t(`a6.store.${s.name}`)), ' ',
      h('span', { class: 'rc-status' }, t(`a6.status.${s.status}`)),
      s.detail ? h('span', { class: 'small' }, ` (${s.detail})`) : null))));
}

function Runtime() {
  const rt = state.runtime;
  if (!rt) return h('p', { class: 'small' }, t('a6.rtNone'));
  const kind = (o) => (o ? `${o.kind ?? ''}${o.name ? ` ${o.name}` : ''}${o.permission ? ` (${o.permission})` : ''}`.trim() : '?');
  return h('ul', { class: 'plain' },
    h('li', null, t('a6.rtData', { v: rt.data })),
    h('li', null, t('a6.rtCalendar', { v: kind(rt.calendar) })),
    h('li', null, t('a6.rtNotif', { v: kind(rt.notifications) })),
    h('li', null, t('a6.rtMic')),
    h('li', null, t('a6.rtVersion', { v: rt.version })));
}

function Capabilities() {
  return h('ul', { class: 'caps' }, CAPABILITIES.map((c) => h('li', { class: `cap cap-${c.label}` },
    h('span', { class: 'cap-label' }, t(`cap.${c.label}`)), ' ', t(c.key))));
}

export function renderPrivacy() {
  const total = { sessions: state.sessions.length, memories: state.memories.length, plans: state.plans.size };
  const cd = state.confirmDelete;
  return h('section', { 'aria-labelledby': 'screen-title' },
    h('h1', { id: 'screen-title', tabindex: '-1' }, t('a6.title')),
    SettingsCard(),
    h('div', { class: 'card' },
      h('h2', null, t('a6.state')),
      h('p', { class: state.paused ? 'warn-strong' : '' }, state.paused ? t('privacy.paused') : t('privacy.nomic')),
      Btn(state.paused ? t('privacy.resume') : t('privacy.pause'), () => { state.paused = !state.paused; rerender(); }, { variant: 'primary' })),
    h('div', { class: 'card' },
      h('h2', null, t('a6.stored')),
      h('ul', { class: 'plain' },
        h('li', null, t('a6.stSessions', { n: total.sessions })), h('li', null, t('a6.stMemories', { n: total.memories })), h('li', null, t('a6.stPlans', { n: total.plans }))),
      cd
        ? h('div', { role: 'alertdialog', 'aria-label': t('a6.confirmTitle') },
          h('h3', null, t('a6.confirmTitle')), h('p', null, t('a6.confirmBody')),
          h('div', { class: 'stack' },
            Btn(t('a6.keep'), () => { state.confirmDelete = null; rerender(); }, { variant: 'primary' }),
            Btn(cd === 'all' ? t('a6.confirmAll') : t('a6.confirmSession'), () => doDelete(cd), { variant: 'danger' })))
        : h('div', { class: 'stack' },
          Btn(t('a6.deleteSession'), () => { state.confirmDelete = 'session'; rerender(); }, { variant: 'danger', disabled: !state.sessions.length }),
          Btn(t('a6.deleteAll'), () => { state.confirmDelete = 'all'; rerender(); }, { variant: 'danger', disabled: !state.sessions.length && !state.memories.length }),
          state.sessions.length ? null : h('p', { class: 'small' }, t('a6.noSession')))),
    ErrorBox(state.privError, { onDismiss: () => { state.privError = null; rerender(); } }),
    state.receipt ? Receipt(state.receipt) : null,
    h('div', { class: 'card' }, h('h2', null, t('a6.runtime')), Runtime()),
    h('div', { class: 'card' }, h('h2', null, t('a6.caps')), h('p', { class: 'small' }, t('a6.capsNote')), Capabilities()));
}
