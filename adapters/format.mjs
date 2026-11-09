// Pure time/format helpers for the action layer. Browser-safe. Owner: sj-actions.
// Korea has no DST, so Asia/Seoul is a fixed +09:00 offset; this avoids relying on Intl data.

const ISO_FULL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const KST_MS = 9 * 3600 * 1000;
const pad = (n, w = 2) => String(n).padStart(w, '0');

function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** Strict ISO-8601 datetime with explicit offset -> epoch ms, else null. Rejects rolled-over dates (Feb 31). */
export function parseExactIso(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_FULL.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export function isDateOnly(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function kstParts(ms) {
  const d = new Date(ms + KST_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}

/** epoch ms -> 'YYYY-MM-DDTHH:MM:SS+09:00' */
export function toKstIso(ms) {
  const p = kstParts(ms);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}+09:00`;
}

/** epoch ms -> 'YYYYMMDDTHHMMSSZ' (RFC 5545 UTC form) */
export function toIcsUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function displayDateTime(ms) {
  const p = kstParts(ms);
  const h12 = p.h % 12 || 12;
  const en = `${WD_EN[p.wd]}, ${p.d} ${MON_EN[p.mo - 1]} ${p.y}, ${h12}:${pad(p.mi)} ${p.h < 12 ? 'AM' : 'PM'} (Seoul time, UTC+9)`;
  const ko = `${p.y}년 ${p.mo}월 ${p.d}일 (${WD_KO[p.wd]}) ${p.h < 12 ? '오전' : '오후'} ${h12}:${pad(p.mi)} (서울 시간)`;
  return { ko, en };
}

/** Structured parts so the UI can show the time zone visibly (never hidden in the locale). */
export function displayParts(ms) {
  const p = kstParts(ms);
  const h12 = p.h % 12 || 12;
  return {
    iana: 'Asia/Seoul', zoneName: { en: 'Seoul time', ko: '서울 시간' }, utcOffset: '+09:00', utcLabel: 'UTC+9',
    weekday: { en: WD_EN[p.wd], ko: WD_KO[p.wd] }, date: { en: `${p.d} ${MON_EN[p.mo - 1]} ${p.y}`, ko: `${p.y}년 ${p.mo}월 ${p.d}일` },
    time12: `${h12}:${pad(p.mi)} ${p.h < 12 ? 'AM' : 'PM'}`, time24: `${pad(p.h)}:${pad(p.mi)}`,
  };
}

export const DEFAULT_LANG = 'en';
/** Pick a language from a {ko,en} object. English is the default; Korean only when asked for. */
export function localize(obj, lang = DEFAULT_LANG) {
  if (obj && typeof obj === 'object' && ('en' in obj || 'ko' in obj)) return (lang === 'ko' ? obj.ko : obj.en) ?? obj.en ?? obj.ko;
  return obj;
}

export function displayOffset(min) {
  if (min % 1440 === 0) { const n = min / 1440; return { ko: `${n}일 전`, en: `${n} day${n > 1 ? 's' : ''} before` }; }
  if (min % 60 === 0) { const n = min / 60; return { ko: `${n}시간 전`, en: `${n} hour${n > 1 ? 's' : ''} before` }; }
  return { ko: `${min}분 전`, en: `${min} minutes before` };
}

/**
 * True when the title already names the person (case-insensitive), so "with <who>" would repeat it
 * ("Copperplate printmaking lesson with Kai with Kai"). Callers then omit the appended who part.
 */
export function titleNamesWho(title, who) {
  const t = String(title ?? '').trim().toLowerCase();
  const w = String(who ?? '').trim().toLowerCase();
  return w !== '' && t.includes(w);
}

/** Human readback with person, date, time and action. Wording depends on the honest state, never implies success unless verified. */
export function readbackText(rec) {
  const f = rec.preview?.fields ?? {};
  const dt = displayDateTime(parseExactIso(f.startsAt));
  const action = f.kind === 'reminder' ? { ko: '알림', en: 'Reminder' } : { ko: '일정', en: 'Appointment' };
  const who = !f.who ? { ko: ' (상대 미정)', en: ' (person unknown)' }
    : titleNamesWho(f.title, f.who) ? { ko: '', en: '' } // the title already says who
      : { ko: ` ${f.who}님과`, en: ` with ${f.who}` };
  const core = {
    ko: `${action.ko}: ${f.title}${who.ko}, ${dt.ko}`,
    en: `${action.en}: ${f.title}${who.en}, ${dt.en}`,
  };
  switch (rec.status) {
    case 'completed':
      if (rec.mode === 'simulated') {
        return { ko: `시뮬레이션입니다. 휴대폰에는 아무것도 저장되지 않았습니다. ${core.ko}`, en: `This is a simulation. Nothing was saved to your phone or calendar. ${core.en}` };
      }
      return rec.verifyLevel === 'user_attested'
        ? { ko: `사용자께서 추가했다고 알려 주셨습니다. EBYS는 확인하지 못했습니다. ${core.ko}`, en: `You told us you added it. EBYS has not checked. ${core.en}` }
        : (() => {
          const cal = rec.calendarLabel ?? { ko: '달력', en: 'the calendar' };
          return { ko: `${cal.ko}에 저장하고 다시 읽어 확인했습니다: ${core.ko}`, en: `Saved in ${cal.en} and read back to check: ${core.en}` };
        })();
    case 'handed_off':
      return { ko: `달력 파일이 준비되었습니다. 아직 달력에 추가되지 않았습니다. 파일을 열어 달력 앱에서 저장을 눌러 주세요. EBYS는 확인할 수 없습니다. ${core.ko}`,
        en: `Your calendar file is ready, but it is not added to your calendar yet. Open it and tap Save in your Calendar app. EBYS can't check whether you did. ${core.en}` };
    case 'permission_denied':
      return { ko: `권한이 없어 진행하지 못했습니다. 아무것도 전송되지 않았습니다. ${core.ko}`, en: `Permission was denied. Nothing was sent. ${core.en}` };
    case 'failed':
      return rec.error?.phase === 'pre_send'
        ? { ko: `진행하지 못했습니다. 아무것도 전송되지 않았습니다. ${core.ko}`, en: `That didn't go through. Nothing was sent. ${core.en}` }
        : { ko: `진행하지 못했습니다. 달력을 확인해 주세요. ${core.ko}`, en: `That didn't go through. Please check your calendar. ${core.en}` };
    case 'unknown_outcome':
      return { ko: `결과를 확인하지 못했습니다. 달력을 직접 확인해 주세요. ${core.ko}`, en: `We can't tell whether this worked. Please check your calendar. ${core.en}` };
    case 'verify_mismatch':
      return { ko: `확인해 보니 요청한 내용과 다릅니다. 사용하지 마세요. ${core.ko}`, en: `What was stored doesn't match what you asked for, so please don't rely on it. ${core.en}` };
    case 'cancelled':
      return rec.cancelNote ?? { ko: `취소되었습니다. ${core.ko}`, en: `Cancelled. ${core.en}` };
    case 'expired':
      return { ko: `내용이 바뀌어 만료되었습니다. 다시 확인해 주세요. ${core.ko}`, en: `The details changed, so this is no longer valid. Please review it again. ${core.en}` };
    default:
      return { ko: `대기 중: ${core.ko}`, en: `Pending: ${core.en}` };
  }
}
