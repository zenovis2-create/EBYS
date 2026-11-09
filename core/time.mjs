// Deterministic KO/EN date+time normalization, Asia/Seoul (UTC+9, no DST).
// The model never computes dates: it copies time phrases verbatim, this module resolves them
// against the injected clock. Ambiguity is returned, never defaulted (CONTRACTS R05).

export const TZ = 'Asia/Seoul';
const OFFSET_MS = 9 * 3600 * 1000;
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const utcMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

export function seoulParts(input) {
  const t = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(t)) throw new Error(`invalid time: ${String(input)}`);
  const d = new Date(t + OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), wd: d.getUTCDay() };
}
export function addDays(dateStr, n) {
  const dt = new Date(utcMs(dateStr) + n * DAY);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export const weekdayOf = (dateStr) => new Date(utcMs(dateStr)).getUTCDay(); // 0 = Sunday
const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
export const toIso = (date, time) => `${date}T${time}:00+09:00`;
export function seoulIso(input) {
  const p = seoulParts(input);
  return `${ymd(p.y, p.m, p.d)}T${pad(p.hh)}:${pad(p.mm)}:00+09:00`;
}
export function seoulDateOf(input) { const p = seoulParts(input); return ymd(p.y, p.m, p.d); }

const KO_WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const KO_WD_NAME = ['일', '월', '화', '수', '목', '금', '토'];
const EN_WD_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MON_NAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_WD = { sunday: 0, monday: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6 };
const EN_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const mondayOffset = (wd) => (wd + 6) % 7;

const NATIVE = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12, 스물: 20, 스물한: 21, 스물두: 22, 스물세: 23, 스물네: 24 };
const NATIVE_RE = '열두|열한|열|스물한|스물두|스물세|스물네|스물|한|두|세|네|다섯|여섯|일곱|여덟|아홉';
const SINO = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
function sinoToInt(s) {
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^([일이삼사오육칠팔구])?십([일이삼사오육칠팔구])?$/);
  if (m) return (m[1] ? SINO[m[1]] : 1) * 10 + (m[2] ? SINO[m[2]] : 0);
  if (s.length === 1 && SINO[s]) return SINO[s];
  return null;
}

const MONTHS_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const EN_WD_RE = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thurs|thur|tue|wed|thu|fri)';

const NUMW = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const EN_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const MIN_RE = "(?:thirty|fifteen|forty[- ]?five|o['\u2019]?clock)";
const minWord = (w) => (w ? (/^thirty/i.test(w) ? 30 : /^fifteen/i.test(w) ? 15 : /^forty/i.test(w) ? 45 : 0) : 0);
const UNIT_NEG = '(?!\\d|\\s*(?:st|nd|rd|th|%|:|min|mins|minutes?|hours?|hrs?|days?|weeks?|months?|years?|people|persons?|times|of\\b|pm\\b|am\\b))';
const DP_AM = /(아침|오전|새벽|morning|breakfast)/i;
const DP_PM = /(오후|저녁|밤|afternoon|evening|night|tonight|dinner)/i;
const DP_LUNCH = /(점심|낮|lunch|midday)/i;
function daypartOf(s) {
  if (/새벽/.test(s)) return 'dawn';
  if (/밤|night|tonight/i.test(s)) return 'night';
  if (DP_LUNCH.test(s)) return 'lunch';
  if (/저녁|evening|dinner/.test(s)) return 'evening';
  if (/오후|afternoon/i.test(s)) return 'afternoon';
  if (DP_AM.test(s)) return 'morning';
  return null;
}
function hourWithDaypart(h, dp) {
  if (h >= 13 || h === 0) return h;
  if (dp === 'morning' || dp === 'dawn') return h === 12 ? 0 : h;
  if (dp === 'lunch') return h === 12 ? 12 : h >= 10 && h <= 11 ? h : h + 12;
  if (dp === 'night') return h === 12 ? 0 : h < 6 ? h : h + 12;
  return h === 12 ? 12 : h + 12; // afternoon / evening
}
function ambiguousHourCandidates(h) {
  if (h === 12) return [12, 0];
  const am = h; const pm = h + 12;
  return h >= 7 && h <= 11 ? [am, pm] : [pm, am];
}

/**
 * Parse ONE time phrase (verbatim text from the transcript).
 * @returns {{matched:boolean, raw:string, date:string|null, dateCandidates:string[], time:string|null,
 *   timeCandidates:string[], hour:number|null, minute:number, ampm:'resolved'|'ambiguous'|null,
 *   daypart:string|null, flags:string[], weekRange:string[]|null}}
 */
export function parseTimePhrase(phrase, anchorIso) {
  const raw = String(phrase ?? '');
  const out = { matched: false, raw, date: null, dateCandidates: [], time: null, timeCandidates: [], hour: null, minute: 0, ampm: null, daypart: null, flags: [], weekRange: null };
  if (!raw.trim()) return out;
  const a = seoulParts(anchorIso);
  const today = ymd(a.y, a.m, a.d);
  const aOff = mondayOffset(a.wd);
  const monStart = addDays(today, -aOff);
  let s = raw;
  const low = () => s.toLowerCase();
  const blank = (m) => { s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length); };
  const flag = (f) => { if (!out.flags.includes(f)) out.flags.push(f); };
  let m;

  // ---- date ----
  const setDate = (d) => { out.date = d; out.dateCandidates = []; out.matched = true; if (d < today) flag('past'); };
  const setCands = (c, f) => { out.date = null; out.dateCandidates = c; out.matched = true; flag(f); };
  const absDate = (y, mo, d, yExplicit) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    let yy = y ?? a.y;
    if (!validDate(yy, mo, d)) return false;
    let ds = ymd(yy, mo, d);
    if (!yExplicit && ds < today) { yy += 1; if (!validDate(yy, mo, d)) return false; ds = ymd(yy, mo, d); flag('past_date_rolled'); }
    setDate(ds); return true;
  };
  let dateDone = false;
  if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) { dateDone = absDate(+m[1], +m[2], +m[3], true); if (dateDone) blank(m); }
  if (!dateDone && (m = s.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) { dateDone = absDate(m[1] ? +m[1] : null, +m[2], +m[3], !!m[1]); if (dateDone) blank(m); }
  if (!dateDone && (m = low().match(new RegExp(`\\b${MONTHS_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`)))) {
    dateDone = absDate(m[3] ? +m[3] : null, EN_MON[m[1].slice(0, 3)], +m[2], !!m[3]); if (dateDone) blank(m);
  }
  if (!dateDone && (m = low().match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS_RE}\\b`)))) {
    dateDone = absDate(null, EN_MON[m[2].slice(0, 3)], +m[1], false); if (dateDone) blank(m);
  }
  if (!dateDone && (m = s.match(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/))) { dateDone = absDate(null, +m[1], +m[2], false); if (dateDone) { flag('numeric_month_day'); blank(m); } }

  if (!dateDone) {
    if ((m = s.match(/내일\s*모레|모레/))) { setDate(addDays(today, 2)); blank(m); dateDone = true; }
    else if ((m = s.match(/글피/))) { setDate(addDays(today, 3)); blank(m); dateDone = true; }
    else if ((m = s.match(/내일/))) { setDate(addDays(today, 1)); blank(m); dateDone = true; if (a.hh < 5) { out.date = null; setCands([today, addDays(today, 1)], 'late_night_tomorrow'); } }
    else if ((m = s.match(/오늘|금일/))) { setDate(today); blank(m); dateDone = true; }
    else if ((m = s.match(/그저께|그제/))) { setDate(addDays(today, -2)); blank(m); dateDone = true; }
    else if ((m = s.match(/어제/))) { setDate(addDays(today, -1)); blank(m); dateDone = true; }
  }
  if (!dateDone) {
    const L = low();
    if ((m = L.match(/\bday after tomorrow\b/))) { setDate(addDays(today, 2)); blank(m); dateDone = true; }
    else if ((m = L.match(/\btomorrow\b/))) { setDate(addDays(today, 1)); blank(m); dateDone = true; if (a.hh < 5) { out.date = null; setCands([today, addDays(today, 1)], 'late_night_tomorrow'); } }
    else if ((m = L.match(/\btoday\b|\btonight\b/))) { setDate(today); /* keep 'tonight' for daypart */ dateDone = true; }
    else if ((m = L.match(/\byesterday\b/))) { setDate(addDays(today, -1)); blank(m); dateDone = true; }
  }
  if (!dateDone) {
    const L = low();
    const wdNth = L.match(new RegExp(`\\b(?:${EN_WD_RE}\\b[,\\s]+(?:the\\s+)?)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\b(?!\\s+(?:of\\s+)?${MONTHS_RE}\\b)`));
    const named = L.match(new RegExp(`\\b(next|this|last)\\s+week,?\\s+(?:on\\s+)?${EN_WD_RE}\\b`));
    const inN = L.match(/\bin\s+(a|an|one|two|three|four|five|six|seven|\d{1,2})\s+(day|days|week|weeks)\b/);
    const thisDp = L.match(/\b(this)\s+(morning|afternoon|evening)\b/);
    if (named) {
      const w = named[1] === 'next' ? 1 : named[1] === 'last' ? -1 : 0;
      setDate(addDays(monStart, w * 7 + mondayOffset(EN_WD[named[2]]))); blank(named); dateDone = true;
    } else if (inN) {
      const n = /^\d/.test(inN[1]) ? +inN[1] : (inN[1] === 'a' || inN[1] === 'an') ? 1 : EN_NUM[inN[1]];
      setDate(addDays(today, /^week/.test(inN[2]) ? n * 7 : n)); flag('relative_offset'); blank(inN); dateDone = true;
    } else if (thisDp) {
      setDate(today); dateDone = true; /* keep the daypart word for AM/PM resolution */
    } else if (wdNth) {
      const dd = +wdNth[2]; let mo = a.m; let yy = a.y;
      if (dd < a.d) { mo += 1; if (mo > 12) { mo = 1; yy += 1; } }
      if (validDate(yy, mo, dd)) {
        const ds = ymd(yy, mo, dd); flag('month_inferred');
        if (wdNth[1] && weekdayOf(ds) !== EN_WD[wdNth[1]]) {
          // "Monday the 16th" where the 16th is not a Monday: never pick silently
          const t = mondayOffset(EN_WD[wdNth[1]]);
          setCands([ds, addDays(monStart, t > aOff ? t : t + 7)], 'weekday_date_mismatch');
        } else setDate(ds);
        blank(wdNth); dateDone = true;
      }
    }
  }
  if (!dateDone) {
    // weekday with explicit week modifier (KO)
    if ((m = s.match(/(다다음\s*주|이번\s*주|금주|다음\s*주|담\s*주|지난\s*주|저번\s*주)\s*([월화수목금토일])\s*(?:요일|욜)/))) {
      const w = /다다음/.test(m[1]) ? 2 : /다음|담/.test(m[1]) ? 1 : /지난|저번/.test(m[1]) ? -1 : 0;
      setDate(addDays(monStart, w * 7 + mondayOffset(KO_WD[m[2]]))); blank(m); dateDone = true;
    } else if ((m = s.match(/(다다음|이번|다음|지난|저번)\s*주말|주말/))) {
      const w = /다다음/.test(m[0]) ? 2 : /다음/.test(m[0]) ? 1 : /지난|저번/.test(m[0]) ? -1 : 0;
      const sat = addDays(monStart, w * 7 + 5); out.weekRange = [sat, addDays(sat, 1)];
      setCands(out.weekRange, 'week_range'); blank(m); dateDone = true;
    } else if ((m = s.match(/([월화수목금토일])\s*(?:요일|욜)/))) {
      const t = mondayOffset(KO_WD[m[1]]);
      if (t === aOff) { setCands([today, addDays(today, 7)], 'bare_weekday_today'); }
      else { setDate(addDays(monStart, t > aOff ? t : t + 7)); flag('bare_weekday'); }
      blank(m); dateDone = true;
    }
  }
  if (!dateDone) {
    const L = low();
    if ((m = L.match(new RegExp(`\\b(this|next|last|coming|upcoming)\\s+${EN_WD_RE}\\b`)))) {
      const t = mondayOffset(EN_WD[m[2]]); const mod = m[1];
      if (mod === 'next') {
        if (t > aOff) setCands([addDays(monStart, t), addDays(monStart, t + 7)], 'next_ambiguous');
        else setDate(addDays(monStart, t + 7));
      } else if (mod === 'last') setDate(addDays(monStart, t - 7));
      else if (mod === 'this') setDate(addDays(monStart, t));
      else { setDate(addDays(monStart, t > aOff ? t : t + 7)); flag('bare_weekday'); }
      blank(m); dateDone = true;
    } else if ((m = L.match(new RegExp(`\\b${EN_WD_RE}\\s+(?:of\\s+)?(next|this|last)\\s+week\\b`)))) {
      const t = mondayOffset(EN_WD[m[1]]); const w = m[2] === 'next' ? 1 : m[2] === 'last' ? -1 : 0;
      setDate(addDays(monStart, w * 7 + t)); blank(m); dateDone = true;
    } else if ((m = L.match(/\b(this|next)?\s*weekend\b/))) {
      const w = m[1] === 'next' ? 1 : 0; const sat = addDays(monStart, w * 7 + 5); out.weekRange = [sat, addDays(sat, 1)];
      setCands(out.weekRange, 'week_range'); blank(m); dateDone = true;
    } else if ((m = L.match(new RegExp(`\\b${EN_WD_RE}\\b`)))) {
      const t = mondayOffset(EN_WD[m[1]]);
      if (t === aOff) setCands([today, addDays(today, 7)], 'bare_weekday_today');
      else { setDate(addDays(monStart, t > aOff ? t : t + 7)); flag('bare_weekday'); }
      blank(m); dateDone = true;
    }
  }
  if (!dateDone && (m = s.match(/(?<![월\d])(\d{1,2})\s*일(?!간|동안|정|요)/))) {
    const dd = +m[1]; let mo = a.m; let yy = a.y;
    if (dd < a.d) { mo += 1; if (mo > 12) { mo = 1; yy += 1; } }
    if (validDate(yy, mo, dd)) { setDate(ymd(yy, mo, dd)); flag('month_inferred'); blank(m); dateDone = true; }
  }
  if (!dateDone && (m = low().match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/))) {
    const dd = +m[1]; let mo = a.m; let yy = a.y;
    if (dd < a.d) { mo += 1; if (mo > 12) { mo = 1; yy += 1; } }
    if (validDate(yy, mo, dd)) { setDate(ymd(yy, mo, dd)); flag('month_inferred'); blank(m); dateDone = true; }
  }
  if (!dateDone && /다음\s*달|next month/i.test(s)) { out.matched = true; flag('month_only'); }
  if (!dateDone && /다음\s*주|next week/i.test(s)) { out.matched = true; flag('week_only'); }

  // ---- time of day ----
  const dp = daypartOf(raw);
  if (dp) { out.daypart = dp; out.matched = true; }
  if (/쯤|무렵|정도|around|about|approximately|roughly/i.test(raw)) flag('approximate_time');
  const setTime = (h, min, explicit) => {
    out.matched = true; out.minute = min;
    if (explicit || h >= 13 || h === 0) { out.time = `${pad(h)}:${pad(min)}`; out.hour = h; out.ampm = 'resolved'; out.timeCandidates = []; return; }
    // bare 1..12 hour (no AM/PM given)
    if (dp && dp !== null) {
      const hh = hourWithDaypart(h, dp);
      out.time = `${pad(hh)}:${pad(min)}`; out.hour = hh; out.ampm = 'resolved'; out.timeCandidates = []; flag('ampm_from_daypart'); return;
    }
    out.time = null; out.hour = h; out.ampm = 'ambiguous';
    out.timeCandidates = ambiguousHourCandidates(h).map((x) => `${pad(x)}:${pad(min)}`);
  };
  const parseMinutes = (tail) => {
    if (!tail) return 0;
    if (/반/.test(tail)) return 30;
    const mm = tail.match(/(\d{1,2}|[일이삼사오육칠팔구십]{1,3})\s*분/);
    if (mm) { const v = sinoToInt(mm[1]); return v != null && v < 60 ? v : 0; }
    return 0;
  };
  let timeDone = false;
  if ((m = s.match(/(?<![\d])(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\b\.?/i))) {
    let h = +m[1]; const min = m[2] ? +m[2] : 0; const pm = m[3].toLowerCase() === 'p';
    if (h >= 1 && h <= 12 && min < 60) { h = pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h); setTime(h, min, true); blank(m); timeDone = true; }
  }
  if (!timeDone && (m = s.match(/(오전|오후|아침|저녁|밤|새벽|낮|점심)?\s*(\d{1,2}|열두|열한|열|스물한|스물두|스물세|스물네|스물|한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*시(?!간)\s*((?:반)|(?:(?:\d{1,2}|[일이삼사오육칠팔구십]{1,3})\s*분))?/))) {
    const h = /^\d+$/.test(m[2]) ? +m[2] : NATIVE[m[2]];
    if (h != null && h >= 0 && h <= 24) {
      const min = parseMinutes(m[3]);
      const localDp = m[1] ? daypartOf(m[1]) : null;
      if (localDp) { setTime(hourWithDaypart(h, localDp) % 24, min, true); if (h === 12 && localDp === 'night') flag('midnight_boundary'); }
      else setTime(h === 24 ? 0 : h, min, h >= 13 || h === 0 || h === 24);
      blank(m); timeDone = true;
    }
  }
  if (!timeDone && (m = s.match(/(?<![\d])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/))) {
    const h = +m[1]; const min = +m[2];
    setTime(h, min, h >= 13 || h === 0 || /(^|\D)0\d:/.test(m[0]) && m[0].length === 5);
    blank(m); timeDone = true;
  }
  if (!timeDone && (m = low().match(/\b(\d{1,2})\s*o['’]?clock\b/))) { setTime(+m[1], 0, +m[1] >= 13 || +m[1] === 0); blank(m); timeDone = true; }
  if (!timeDone && (m = low().match(new RegExp(`\\b(half past|quarter past|a quarter past|quarter to|a quarter to)\\s+(\\d{1,2}|${NUMW})\\b`)))) {
    let h = /^\d/.test(m[2]) ? +m[2] : EN_NUM[m[2]];
    if (h >= 1 && h <= 12) {
      const min = /half/.test(m[1]) ? 30 : /past/.test(m[1]) ? 15 : 45;
      if (/to/.test(m[1])) h = h === 1 ? 12 : h - 1;
      setTime(h, min, false); blank(m); timeDone = true;
    }
  }
  if (!timeDone && (m = low().match(/\b(\d{1,2})(?::([0-5]\d))?\s+(?:in the|at)\s+(morning|afternoon|evening|night)\b/))) {
    if (+m[1] >= 1 && +m[1] <= 12) { setTime(+m[1], m[2] ? +m[2] : 0, false); blank(m); timeDone = true; }
  }
  if (!timeDone && (m = low().match(new RegExp(`\\b(?:(?:at|around|about)\\s+)?${NUMW}\\s+(${MIN_RE})`)))) {
    setTime(EN_NUM[m[1]], minWord(m[2]), false); blank(m); timeDone = true;
  }
  if (!timeDone && (m = low().match(new RegExp(`\\b(?:at|around|about)\\s+${NUMW}\\b`)))) { setTime(EN_NUM[m[1]], 0, false); blank(m); timeDone = true; }
  if (!timeDone && (m = low().match(new RegExp(`(?:\\bat|\\baround|\\babout|@)\\s*(\\d{1,2})${UNIT_NEG}`)))) { if (+m[1] <= 24) { setTime(+m[1], 0, +m[1] >= 13 || +m[1] === 0); blank(m); timeDone = true; } }
  if (!timeDone && (m = low().match(/\bnoon\b|\bmidday\b|정오/))) { setTime(12, 0, true); timeDone = true; }
  if (!timeDone && (m = low().match(/\bmidnight\b|자정/))) { setTime(0, 0, true); timeDone = true; }
  return out;
}

/** Merge several parsed phrases of ONE memory (later phrases refine/override earlier ones). */
export function mergeParts(parts) {
  const c = { date: null, dateCandidates: [], time: null, timeCandidates: [], hour: null, minute: 0, ampm: null, daypart: null, flags: [], weekRange: null, matched: false };
  for (const p of parts) {
    if (!p || !p.matched) continue;
    c.matched = true;
    if (p.date) { c.date = p.date; c.dateCandidates = []; c.weekRange = p.weekRange ?? null; }
    else if (p.dateCandidates.length) { c.date = null; c.dateCandidates = p.dateCandidates; c.weekRange = p.weekRange ?? null; }
    if (p.time) { c.time = p.time; c.timeCandidates = []; c.hour = p.hour; c.minute = p.minute; c.ampm = 'resolved'; }
    else if (p.ampm === 'ambiguous') { c.time = null; c.timeCandidates = p.timeCandidates; c.hour = p.hour; c.minute = p.minute; c.ampm = 'ambiguous'; }
    if (p.daypart) c.daypart = p.daypart;
    for (const f of p.flags) if (!c.flags.includes(f)) c.flags.push(f);
  }
  // AM/PM resolved from an explicit daypart elsewhere in the same memory (e.g. "lunch" + "12:30").
  if (c.ampm === 'ambiguous' && c.daypart && c.hour != null) {
    const hh = hourWithDaypart(c.hour, c.daypart) % 24;
    c.time = `${pad(hh)}:${pad(c.minute)}`; c.ampm = 'resolved'; c.timeCandidates = [];
    if (!c.flags.includes('ampm_from_daypart')) c.flags.push('ampm_from_daypart');
  }
  return c;
}

const KO_DP = { dawn: '새벽', morning: '아침', lunch: '점심', afternoon: '오후', evening: '저녁', night: '밤' };
const EN_DP = { dawn: 'early morning', morning: 'morning', lunch: 'lunchtime', afternoon: 'afternoon', evening: 'evening', night: 'night' };

export function fmtDate(date) {
  const [y, m, d] = date.split('-').map(Number); const wd = weekdayOf(date);
  return { ko: `${m}월 ${d}일(${KO_WD_NAME[wd]})`, en: `${EN_WD_NAME[wd]}, ${EN_MON_NAME[m - 1]} ${d}`, y };
}
export function fmtTime(time) {
  const [h, m] = time.split(':').map(Number);
  const ap = h < 12 ? '오전' : '오후'; const h12 = h % 12 === 0 ? 12 : h % 12;
  const ko = `${ap} ${h12}시${m ? ` ${m}분` : ''}`;
  const en = `${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  return { ko, en };
}

/** Build the `when` Slot (CONTRACTS section 3) from merged parts. Never invents a missing piece. */
export function buildWhenSlot(parts, { evidence = [], confidence = 'stated', lang = 'ko' } = {}) {
  const c = Array.isArray(parts) ? mergeParts(parts) : parts;
  if (!c.matched) return { state: 'unknown', uncertainty: 'unknown', evidence: [], value: null, clarification: { ko: '언제인가요?', en: 'When is it?' } };
  const ambDate = !c.date && c.dateCandidates.length > 1;
  const ambTime = !c.time && c.timeCandidates.length > 1;
  const dateTxt = c.date ? fmtDate(c.date) : null;
  const timeTxt = c.time ? fmtTime(c.time) : null;
  const dpKo = c.daypart ? KO_DP[c.daypart] : null; const dpEn = c.daypart ? EN_DP[c.daypart] : null;
  const value = { date: c.date, time: c.time, startIso: c.date && c.time ? toIso(c.date, c.time) : null, tz: TZ, daypart: c.daypart, flags: c.flags, hour: c.hour };
  let state; let uncertainty; let clarification; let candidates;
  if (ambDate || ambTime) {
    state = 'ambiguous'; uncertainty = 'ambiguous';
    const ds = c.date ? [c.date] : c.dateCandidates.length ? c.dateCandidates : [null];
    const ts = c.time ? [c.time] : c.timeCandidates.length ? c.timeCandidates : [null];
    candidates = [];
    for (const d of ds) for (const t of ts) {
      const lk = [d ? fmtDate(d).ko : null, t ? fmtTime(t).ko : null].filter(Boolean).join(' ');
      const le = [d ? fmtDate(d).en : null, t ? fmtTime(t).en : null].filter(Boolean).join(' ');
      candidates.push({ date: d, time: t, startIso: d && t ? toIso(d, t) : null, labelKo: lk, labelEn: le });
    }
    if (ambTime && ambDate) clarification = { ko: '날짜와 오전/오후를 알려주세요.', en: 'Which day, and is it AM or PM?' };
    else if (ambTime) clarification = { ko: '오전인가요, 오후인가요?', en: 'Is that AM or PM?' };
    else if (c.weekRange) clarification = { ko: '토요일인가요, 일요일인가요?', en: 'Saturday or Sunday?' };
    else clarification = { ko: '어느 날짜인가요?', en: 'Which date do you mean?' };
  } else if (c.date && c.time) { state = 'known'; }
  else if (c.date || c.time || c.daypart) {
    state = 'partial';
    clarification = c.date ? { ko: '몇 시인가요?', en: 'What time?' } : { ko: '어느 날인가요?', en: 'Which day?' };
  } else {
    state = 'partial'; clarification = { ko: '언제인가요?', en: 'When is it?' };
  }
  if (state !== 'ambiguous') {
    const f = c.flags;
    uncertainty = f.includes('approximate_time') || confidence === 'approximate' ? 'approximate'
      : f.some((x) => ['ampm_from_daypart', 'month_inferred', 'past_date_rolled', 'bare_weekday', 'numeric_month_day', 'midnight_boundary'].includes(x)) || confidence === 'inferred' ? 'inferred' : 'stated';
  }
  const kParts = []; const eParts = [];
  if (dateTxt) { kParts.push(dateTxt.ko); eParts.push(dateTxt.en); }
  else if (c.dateCandidates.length) { kParts.push(c.dateCandidates.map((d) => fmtDate(d).ko).join(' 또는 ')); eParts.push(c.dateCandidates.map((d) => fmtDate(d).en).join(' or ')); }
  if (timeTxt) { kParts.push(timeTxt.ko); eParts.push(timeTxt.en); }
  else if (c.timeCandidates.length) {
    const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12;
    kParts.push(`${h12}시${c.minute ? ` ${c.minute}분` : ''} (오전/오후 확인 필요)`); eParts.push(`${h12}:${pad(c.minute)} (AM or PM?)`);
  } else if (dpKo) { kParts.push(dpKo); eParts.push(dpEn); }
  const displayKo = kParts.join(' ') || '시간 미정'; const displayEn = eParts.join(' ') || 'time unknown';
  value.displayKo = displayKo; value.displayEn = displayEn;
  const slot = { state, value, display: lang === 'ko' ? displayKo : displayEn, uncertainty, evidence };
  if (candidates) slot.candidates = candidates;
  if (clarification) slot.clarification = clarification;
  return slot;
}

/** Locate time-like spans in free text (used only by the labelled fallback extractor). */
export function scanTimePhrases(text) {
  const pats = [
    /\d{4}-\d{1,2}-\d{1,2}/g, /(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/g,
    new RegExp(`\\b${MONTHS_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'), /(?<![\d/])\d{1,2}\/\d{1,2}(?![\d/])/g,
    /내일\s*모레|모레|글피|내일|오늘|금일|어제|그저께|그제/g,
    /(?:다다음\s*주|이번\s*주|금주|다음\s*주|담\s*주|지난\s*주|저번\s*주)\s*[월화수목금토일]\s*(?:요일|욜)/g,
    /(?:다다음|이번|다음|지난|저번)?\s*주말/g, /[월화수목금토일]\s*(?:요일|욜)/g,
    /\bday after tomorrow\b|\btomorrow\b|\btoday\b|\btonight\b|\byesterday\b/gi,
    new RegExp(`\\b(?:this|next|last|coming|upcoming)\\s+${EN_WD_RE}\\b`, 'gi'),
    /\b(?:this|next)?\s*weekend\b/gi, new RegExp(`\\b${EN_WD_RE}\\b`, 'gi'),
    /(?:오전|오후|아침|저녁|밤|새벽|낮|점심)?\s*(?:\d{1,2}|열두|열한|열|스물한|스물두|스물세|스물네|스물|한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*시(?!간)\s*(?:반|(?:\d{1,2}|[일이삼사오육칠팔구십]{1,3})\s*분)?/g,
    /(?<![\d])\d{1,2}(?::\d{2})?\s*[ap]\.?m\b\.?/gi, /(?<![\d])(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/g,
    new RegExp(`(?:\\bat|\\baround|\\babout|@)\\s*\\d{1,2}${UNIT_NEG}`, 'gi'),
    new RegExp(`\\b(?:half past|quarter past|a quarter past|quarter to|a quarter to)\\s+(?:\\d{1,2}|${NUMW})\\b`, 'gi'),
    /\b\d{1,2}(?::[0-5]\d)?\s+(?:in the|at)\s+(?:morning|afternoon|evening|night)\b/gi,
    new RegExp(`\\b(?:(?:at|around|about)\\s+)?${NUMW}\\s+${MIN_RE}`, 'gi'), new RegExp(`\\b(?:at|around|about)\\s+${NUMW}\\b`, 'gi'),
    new RegExp(`\\b(?:next|this|last)\\s+week,?\\s+(?:on\\s+)?${EN_WD_RE}\\b`, 'gi'), new RegExp(`\\b${EN_WD_RE}\\s+(?:of\\s+)?(?:next|this|last)\\s+week\\b`, 'gi'),
    new RegExp(`\\b(?:${EN_WD_RE}\\b[,\\s]+(?:the\\s+)?)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)\\b(?!\\s+(?:of\\s+)?${MONTHS_RE}\\b)`, 'gi'),
    /\bin\s+(?:a|an|one|two|three|four|five|six|seven|\d{1,2})\s+(?:day|days|week|weeks)\b/gi, /\bthis\s+(?:morning|afternoon|evening)\b/gi, /\b\d{1,2}\s*o['’]?clock\b/gi, /\bnoon\b|\bmidnight\b|정오|자정/gi,
    /점심|저녁|아침|새벽|오전|오후|\blunch(?:time)?\b|\bmorning\b|\bafternoon\b|\bevening\b/gi,
  ];
  const spans = [];
  for (const re of pats) for (const m of text.matchAll(re)) {
    const raw = m[0]; const lead = raw.length - raw.trimStart().length; const trail = raw.length - raw.trimEnd().length;
    const start = m.index + lead; const end = m.index + raw.length - trail;
    if (end > start) spans.push([start, end]);
  }
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) { last[1] = Math.max(last[1], sp[1]); continue; }
    if (last && /^[\s,]*(?:에|은|는|의|at|on|in the)?\s*$/i.test(text.slice(last[1], sp[0])) && sp[0] - last[1] <= 4) { last[1] = sp[1]; continue; }
    merged.push([sp[0], sp[1]]);
  }
  return merged.map(([s, e]) => ({ start: s, end: e, text: text.slice(s, e) }));
}
