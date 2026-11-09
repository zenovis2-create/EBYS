// Inline SVG icons, built with createElementNS (no innerHTML).
// Every icon is decorative (aria-hidden): the visible word next to it carries the meaning.
// Style follows the mascot icon: soft rounded shapes, round strokes, a light tint of the same colour inside.

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

// [tag, attrs] lists on a 24x24 grid, 2px round strokes. T* = tinted body shape.
const P = (d) => ['path', { d }];
const TP = (d) => ['path', { d, class: 'tint' }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const TC = (cx, cy, r) => ['circle', { cx, cy, r, class: 'tint' }];
const TR = (x, y, width, height, rx) => ['rect', { x, y, width, height, rx, class: 'tint' }];
const DOT = (x, y) => P(`M${x} ${y}h.01`);
export const ICONS = {
  home: [TP('M4.5 11.2 11 5.6a1.6 1.6 0 0 1 2 0l6.5 5.6V19a2 2 0 0 1-2 2h-3v-5.5h-5V21h-3a2 2 0 0 1-2-2z')],
  memories: [TR(5.5, 3.5, 13, 17, 3), P('M9 9h6'), P('M9 13h6'), P('M9 17h3.5')],
  ask: [TP('M6.5 4.5h11a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H12l-4.5 3.5v-3.5h-1a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z'), DOT(8.5, 10.5), DOT(12, 10.5), DOT(15.5, 10.5)],
  plans: [TR(3.5, 5.5, 17, 15, 3.5), P('M3.5 10.5h17'), P('M8 3.5v4'), P('M16 3.5v4'), P('M9 15.5l2 2 4-4')],
  settings: [P('M4 7h8.5'), P('M17.5 7H20'), TC(15, 7, 2.5), P('M4 17h2.5'), P('M11.5 17H20'), TC(9, 17, 2.5)],
  shield: [TP('M12 3.2 18.4 5.8a1 1 0 0 1 .6.9V11c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6.7a1 1 0 0 1 .6-.9z'), P('M9 12l2 2 4-4')],
  micOff: [P('M15 10V6a3 3 0 0 0-5.6-1.5'), P('M9 9v2a3 3 0 0 0 4.7 2.5'), P('M5.5 11a6.5 6.5 0 0 0 10.4 5.2'), P('M18.5 11a6.5 6.5 0 0 1-.6 2.7'), P('M12 17.5V21'), P('M3.5 3.5l17 17')],
  mic: [TP('M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z'), P('M5.5 11a6.5 6.5 0 0 0 13 0'), P('M12 17.5V21')],
  pause: [P('M9 5v14'), P('M15 5v14')],
  person: [TC(12, 8, 4), P('M4.5 20.5c1-4.6 4-7 7.5-7s6.5 2.4 7.5 7')],
  clock: [TC(12, 12, 8.5), P('M12 7.5V12l3 2')],
  pin: [TP('M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z'), C(12, 10, 2.3)],
  note: [TR(5, 4, 14, 16, 3), P('M8.5 9h7'), P('M8.5 13h7'), P('M8.5 17h4')],
  add: [TR(4, 4, 16, 16, 4.5), P('M12 8.5v7'), P('M8.5 12h7')],
  search: [TC(10.5, 10.5, 6), P('M15 15l5 5')],
  quote: [P('M6 7h4.5v4.5H6c0 3 1 4.3 3 5.3'), P('M13.5 7H18v4.5h-4.5c0 3 1 4.3 3 5.3')],
  check: [P('M5 12.5l4.5 4.5L19 7.5')],
  arrow: [P('M5 12h13'), P('M13 6.5 18.5 12 13 17.5')],
  sparkle: [P('M12 3.5v4'), P('M12 16.5v4'), P('M3.5 12h4'), P('M16.5 12h4'), TP('M12 8.5l1.2 2.3 2.3 1.2-2.3 1.2L12 15.5l-1.2-2.3L8.5 12l2.3-1.2z')],
};

export function Icon(name, { size = 28, cls = '' } = {}) {
  const spec = ICONS[name] ?? [];
  return svgEl('svg', {
    viewBox: '0 0 24 24', width: size, height: size, class: `icon ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, spec.map(([tag, a]) => svgEl(tag, a)));
}
