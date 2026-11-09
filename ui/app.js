// EBYS UI entry. Static ES modules, no build. Track A app (CONTRACTS section 2).
import { h } from './lib/dom.js';
import { t, getLang, setLang } from './i18n.js';
import { state, app, setRenderer, rerender, go } from './store.js';
import { selectApi } from './services/api.js';
import { modelChipInfo, Btn } from './components.js';
import { displayStateSource } from './lib/contracts.js';
import { loadPrefs } from './lib/prefs.js';
import { Icon } from './lib/icons.js';
import { renderHome } from './screens/home.js';
import { renderInput } from './screens/input.js';
import { renderMemories } from './screens/memories.js';
import { renderAsk } from './screens/ask.js';
import { renderProposal } from './screens/proposal.js';
import { renderPlans } from './screens/plans.js';
import { renderPrivacy } from './screens/privacy.js';
import { stopSpeaking, stopListening } from './lib/speech.js';

const SCREENS = { home: renderHome, input: renderInput, memories: renderMemories, ask: renderAsk, proposal: renderProposal, plans: renderPlans, privacy: renderPrivacy };
const NAV = [
  { route: 'home', key: 'nav.home', icon: 'home', also: ['input', 'plans', 'proposal'] },
  { route: 'ask', key: 'nav.ask', icon: 'ask' },
  { route: 'memories', key: 'nav.memory', icon: 'memories' },
  { route: 'privacy', key: 'nav.settings', icon: 'settings' },
];

/** Sample vs live, in plain words. The technical route detail lives in Settings and next to results. */
function ModePill() {
  const live = app.apiKind === 'live';
  const m = modelChipInfo();
  const fallback = live && m.cls === 'chip-fallback';
  const cls = !live ? 'pill-sample' : fallback ? 'pill-fallback' : 'pill-live';
  return h('span', { class: `modepill ${cls}`, title: m.text },
    h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), t(!live ? 'mode.sample' : fallback ? 'mode.liveFallback' : 'mode.live'));
}

function AppBar() {
  return h('header', { class: 'appbar' },
    h('button', { type: 'button', class: 'brand', title: t('app.tagline'), 'aria-label': `${t('app.name')} · ${t('nav.home')}`, onClick: () => go('home') },
      h('img', { class: 'brand-icon', src: 'assets/ebys-icon-96.png', width: '40', height: '40', alt: '' }),
      h('span', { class: 'wordmark' }, t('app.name'))),
    ModePill());
}

function PrivacyBar() {
  const paused = state.paused;
  const listening = state.listening && !paused;
  const cls = listening ? 'pb-listening' : paused ? 'pb-paused' : 'pb-off';
  return h('div', { class: `privacybar ${cls}`, role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'pb-icon' }, Icon(listening ? 'mic' : paused ? 'pause' : 'micOff', { size: 26 })),
    h('span', { class: 'pb-text' }, listening ? t('privacy.listening') : paused ? t('privacy.paused') : t('privacy.nomic')),
    listening ? Btn(t('mic.stop'), () => stopListening(), { variant: 'bar' }) : null,
    Btn(paused ? t('privacy.resume') : t('privacy.pause'), () => { state.paused = !state.paused; rerender(); }, { variant: 'bar' }));
}

function Nav() {
  return h('nav', { class: 'bottomnav', 'aria-label': t('app.name') },
    NAV.map((n) => {
      const on = state.route === n.route || n.also?.includes(state.route);
      return h('button', {
        type: 'button', class: `nav-item ${on ? 'nav-on' : ''}`, 'aria-current': on ? 'page' : null, onClick: () => go(n.route),
      }, Icon(n.icon, { size: 28, cls: 'nav-icon' }), h('span', { class: 'nav-label' }, t(n.key)));
    }));
}

function render({ focus = false } = {}) {
  // Never keep the microphone open when leaving Ask or pausing.
  if (state.listening && (state.paused || state.route !== 'ask')) stopListening();
  if (state.speaking && state.route === 'input') { stopSpeaking(); state.speaking = null; }
  const root = document.getElementById('app');
  const y = window.scrollY;
  document.documentElement.style.setProperty('--scale', String(state.scale));
  document.documentElement.lang = getLang();
  const main = h('main', { id: 'main', class: `main screen-${state.route}`, tabindex: '-1' }, (SCREENS[state.route] ?? renderHome)());
  root.replaceChildren(
    h('div', { class: 'topstack' }, AppBar(), PrivacyBar()), main,
    h('footer', { class: 'foot' },
      h('p', { class: 'honesty' }, t('foot.honesty')),
      h('p', { class: 'small' }, t('foot.dsrc', { src: displayStateSource }))),
    Nav());
  if (focus) {
    window.scrollTo(0, 0);
    document.getElementById('screen-title')?.focus({ preventScroll: true });
  } else {
    window.scrollTo(0, y);
  }
}

async function boot() {
  const q = new URLSearchParams(location.search);
  // Fresh storage => English. Only an explicit ?lang= or a saved choice changes it (never navigator.language).
  const prefs = loadPrefs(location.search);
  setLang(prefs.lang);
  state.scale = prefs.scale;
  app.api = selectApi(location.search);
  app.apiKind = app.api.kind;
  if (q.get('route') && SCREENS[q.get('route')]) state.route = q.get('route');
  setRenderer(render);
  render({ focus: false });
  const rt = await app.api.runtime();
  state.runtime = rt.ok ? rt.data : null;
  render({ focus: false });
}

boot();
