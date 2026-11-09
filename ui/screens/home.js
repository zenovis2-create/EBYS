// Home hub: the mascot, a time-aware greeting, one big "Talk to EBYS", and three things that really work.
import { h } from '../lib/dom.js';
import { t } from '../i18n.js';
import { state, go } from '../store.js';
import { Icon } from '../lib/icons.js';
import { recognitionCtor } from '../lib/speech.js';

/** Greeting by the device's local hour; the text never claims to know anything else about the person. */
export function greetingKey(hour) {
  if (hour >= 5 && hour < 12) return 'home.morning';
  if (hour >= 12 && hour < 18) return 'home.afternoon';
  return 'home.evening';
}

const ACTIONS = [
  { key: 'home.actPlans', icon: 'plans', route: 'plans', cls: 'act-plans' },
  { key: 'home.actAdd', icon: 'add', route: 'input', cls: 'act-add' },
  { key: 'home.actFind', icon: 'search', route: 'memories', cls: 'act-find' },
];

export function renderHome() {
  const voice = Boolean(recognitionCtor());
  const n = state.memories.length;
  return h('section', { class: 'home', 'aria-labelledby': 'screen-title' },
    h('div', { class: 'mascot-wrap' },
      h('img', { class: 'mascot', src: 'assets/ebys-icon-512.png', width: '168', height: '168', alt: t('home.mascotAlt') })),
    h('h1', { id: 'screen-title', tabindex: '-1', class: 'greeting' }, t(greetingKey(new Date().getHours()))),
    h('p', { class: 'help' }, t('home.help')),
    h('button', { type: 'button', class: 'btn btn-primary btn-talk', onClick: () => go('ask') },
      Icon(voice ? 'mic' : 'ask', { size: 34 }), h('span', null, t('home.talk'))),
    h('p', { class: 'small talk-note' }, t('home.talkNote')),
    h('h2', { class: 'visually-hidden' }, t('home.actions')),
    h('div', { class: 'actions' }, ACTIONS.map((a) => h('button', {
      type: 'button', class: `action ${a.cls}`, onClick: () => go(a.route),
    }, h('span', { class: 'action-icon' }, Icon(a.icon, { size: 36 })), h('span', { class: 'action-label' }, t(a.key))))),
    n ? h('p', { class: 'small home-count' }, t('home.count', { n, p: state.plans.size })) : null);
}
