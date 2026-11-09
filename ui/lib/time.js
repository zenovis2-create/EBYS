// Date/time helpers for the UI. Display and form composition only; the real
// date normalisation is done in core (CONTRACTS section 1). Times are Asia/Seoul (+09:00).

export const TZ = 'Asia/Seoul';
const pad = (n) => String(n).padStart(2, '0');

/** Parse "2026-11-12T15:00:00+09:00" -> parts, or null when not an exact Seoul datetime. */
export function parseIso(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(iso || '');
  if (!m) return null;
  if (m[4] && m[4] !== '+09:00') return null;
  const h24 = Number(m[2]);
  return { date: m[1], h24, minute: Number(m[3]), hour12: h24 % 12 || 12, ampm: h24 >= 12 ? 'pm' : 'am' };
}

export function isDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

/** Compose ISO from form parts. Returns null unless date, hour, minute AND am/pm are all chosen. */
export function composeIso({ date, hour12, minute, ampm }) {
  if (!isDateOnly(date)) return null;
  const hh = Number(hour12);
  const mm = Number(minute);
  if (!Number.isInteger(hh) || hh < 1 || hh > 12) return null;
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
  if (ampm !== 'am' && ampm !== 'pm') return null;
  const h24 = (hh % 12) + (ampm === 'pm' ? 12 : 0);
  return `${date}T${pad(h24)}:${pad(mm)}:00+09:00`;
}

const loc = (lang) => (lang === 'en' ? 'en-US' : 'ko-KR');

function toDate(iso) {
  if (isDateOnly(iso)) return new Date(`${iso}T12:00:00+09:00`);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso, lang) {
  const d = toDate(iso);
  if (!d) return null;
  const opts = lang === 'en'
    ? { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }
    : { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'long' };
  return new Intl.DateTimeFormat(loc(lang), opts).format(d);
}

export function formatTime(iso, lang) {
  if (!iso || isDateOnly(iso)) return null;
  const d = toDate(iso);
  if (!d) return null;
  return new Intl.DateTimeFormat(loc(lang), { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

export function formatWhen(iso, lang) {
  const date = formatDate(iso, lang);
  if (!date) return null;
  const time = formatTime(iso, lang);
  return time ? `${date} ${time}` : date;
}

export function offsetLabel(min, lang) {
  if (min % 1440 === 0) {
    const d = min / 1440;
    return lang === 'en' ? `${d} day${d > 1 ? 's' : ''} before` : `${d}일 전`;
  }
  if (min % 60 === 0) {
    const hr = min / 60;
    return lang === 'en' ? `${hr} hour${hr > 1 ? 's' : ''} before` : `${hr}시간 전`;
  }
  return lang === 'en' ? `${min} min before` : `${min}분 전`;
}
