// Display preferences only: language and text size. Never conversation data (privacy).
// English is the default for fresh storage. The browser/OS locale (navigator.language) is deliberately NOT used,
// and a Korean-locale browser still starts in English until the user picks Korean.

const KEY = 'ebys.prefs';
const getStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadPrefs(search = '', storage = getStorage()) {
  const q = new URLSearchParams(search);
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(KEY) ?? 'null') ?? {}; } catch { saved = {}; }
  const urlLang = q.get('lang');
  const lang = urlLang === 'ko' || urlLang === 'en' ? urlLang : (saved.lang === 'ko' || saved.lang === 'en' ? saved.lang : 'en');
  const urlScale = Number(q.get('scale'));
  const scale = [1, 1.25, 1.5].includes(urlScale) ? urlScale : ([1, 1.25, 1.5].includes(saved.scale) ? saved.scale : 1);
  return { lang, scale };
}

export function savePrefs({ lang, scale }, storage = getStorage()) {
  try { storage?.setItem(KEY, JSON.stringify({ lang: lang === 'ko' ? 'ko' : 'en', scale: [1, 1.25, 1.5].includes(scale) ? scale : 1 })); } catch { /* storage may be blocked */ }
}
