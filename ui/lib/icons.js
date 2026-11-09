// Inline SVG icons + the EBYS brand mark, built with createElementNS (no innerHTML).
// Every icon is decorative (aria-hidden): the visible word next to it carries the meaning.

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

// [tag, attrs] lists on a 24x24 grid, 2px round strokes.
const P = (d) => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
export const ICONS = {
  home: [P('M4 11.5 12 4.5l8 7V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z')],
  memories: [P('M6 3.5h9l4 4V20.5H6z'), P('M15 3.5v4h4'), P('M9 12h7'), P('M9 16h5')],
  ask: [P('M4 5h16v11H10l-5 4v-4H4z'), P('M10 9a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6'), P('M12 14.2v.1')],
  plans: [P('M4 6h16v14H4z'), P('M4 10h16'), P('M8 3.5v4'), P('M16 3.5v4'), P('M9 15l2 2 4-4')],
  settings: [P('M4 7h9'), P('M17 7h3'), C(15, 7, 2), P('M4 17h3'), P('M11 17h9'), C(9, 17, 2)],
  shield: [P('M12 3 19 6v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z'), P('M9 12l2 2 4-4')],
  micOff: [P('M15 10V6a3 3 0 0 0-5.6-1.5'), P('M9 9v2a3 3 0 0 0 4.7 2.5'), P('M5.5 11a6.5 6.5 0 0 0 10.4 5.2'), P('M18.5 11a6.5 6.5 0 0 1-.6 2.7'), P('M12 17.5V21'), P('M3.5 3.5l17 17')],
  mic: [P('M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z'), P('M5.5 11a6.5 6.5 0 0 0 13 0'), P('M12 17.5V21')],
  pause: [P('M9 5v14'), P('M15 5v14')],
  person: [C(12, 8, 4), P('M4.5 20.5c1-4.6 4-7 7.5-7s6.5 2.4 7.5 7')],
  clock: [C(12, 12, 8.5), P('M12 7.5V12l3 2')],
  pin: [P('M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z'), C(12, 10, 2.3)],
  note: [P('M5 4.5h14v15H5z'), P('M8.5 9h7'), P('M8.5 13h7'), P('M8.5 17h4')],
  quote: [P('M6 7h4.5v4.5H6c0 3 1 4.3 3 5.3'), P('M13.5 7H18v4.5h-4.5c0 3 1 4.3 3 5.3')],
  check: [P('M5 12.5l4.5 4.5L19 7.5')],
  arrow: [P('M5 12h13'), P('M13 6.5 18.5 12 13 17.5')],
  sparkle: [P('M12 3.5v4'), P('M12 16.5v4'), P('M3.5 12h4'), P('M16.5 12h4'), P('M12 8.5l1.2 2.3 2.3 1.2-2.3 1.2L12 15.5l-1.2-2.3L8.5 12l2.3-1.2z')],
};

export function Icon(name, { size = 28, cls = '' } = {}) {
  const spec = ICONS[name] ?? [];
  return svgEl('svg', {
    viewBox: '0 0 24 24', width: size, height: size, class: `icon ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, spec.map(([tag, a]) => svgEl(tag, a)));
}

/** EBYS brand mark: a person, with a companion arc always at their side. Same geometry as assets/ebys-mark.svg. */
export function BrandMark({ size = 44, cls = '' } = {}) {
  return svgEl('svg', { viewBox: '0 0 64 64', width: size, height: size, class: `brandmark ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' },
    svgEl('rect', { width: 64, height: 64, rx: 16, fill: 'var(--mark-bg, #13284A)' }),
    svgEl('circle', { cx: 27, cy: 25, r: 8.5, fill: '#FBF6EC' }),
    svgEl('path', { d: 'M12.5 50.5c1.6-9.2 7.4-14 14.5-14s12.9 4.8 14.5 14z', fill: '#FBF6EC' }),
    svgEl('path', { d: 'M42.5 13.5a21 21 0 0 1 0 37', fill: 'none', stroke: '#E2B65A', 'stroke-width': 5.5, 'stroke-linecap': 'round' }),
    svgEl('circle', { cx: 49.5, cy: 32, r: 3, fill: '#E2B65A' }));
}
