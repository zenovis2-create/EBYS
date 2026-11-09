// FALLBACK rule-based extractor. mode:'fallback'. Used ONLY when the model route fails (never as the AI claim).
// It emits the same JSON shape as the model prompt so the same validator and consolidation run on it.
// It is deliberately shallow: keyword cues + time scanning + honorific/kin/capitalized-name matching.
import { scanTimePhrases } from './time.mjs';

const NEG = /안\s*돼|안\s*되|안\s*될|못\s*(?:해|가|하)|어려워|힘들|곤란|no longer (?:work|good|possible|available|free)|can'?t (?:make|do|come|go|attend|join)|cannot (?:make|do|come|go|attend)|can not (?:make|do|come|go)|won'?t be able|not (?:available|free|possible)|unavailable|(?:is|am|are|be) busy|doesn'?t (?:work|suit)|won'?t work|isn'?t (?:good|possible|going to work)|not going to work|is no longer good|no longer good|doesn'?t fit/i;
const CANCEL = /취소|없던\s*걸로|cancel|called off|'s off\b|call(?:ing)? it off|scrap(?:ped)?|never ?mind|forget (?:it|about)|(?:is|are|was|will be) off\b|no longer (?:happening|on)|won'?t (?:happen|be happening)|not (?:happening|going ahead)|drop(?:ped)? (?:it|the)/i;
const REPLACE = /바꿨|바뀐|바뀌|변경|대신|미뤄|로\s*하자|어때|instead|how about|what about|\b(?:move|moved|moving|push|pushed|pushing|shift|shifted|switch|switched|switching|change|changed|swap|swapped)\b[^.?!]{0,40}?\b(?:to|up|back)\b|re-?schedul|let'?s (?:do|make|move|try)|make it|works? better|can we (?:do|move|make|meet)/i;
const AGREE = /좋아|그래|그렇게\s*하자|알겠|sounds (?:good|great|perfect)|\bok(?:ay)?\b|\bdeal\b|works for me|that works|perfect|see you then|fine by me|\bsure\b|\byes\b|\byep\b|\bgreat\b|let'?s do (?:that|it)/i;
const EVENT_KW = /예약|약속|병원|진료|점심|저녁\s*식사|모임|만나|보자|appointment|lunch|dinner|breakfast|brunch|coffee|meeting|visit|see you|\bmeet\b|doctor|clinic|checkup|class|lesson|workshop|session|party|swap|club|rehearsal|practice|concert|recital|walk|trip|pick-?up|drop-?off|interview|reservation|call with|get-?together/i;
const TASK_KW = /해야|가야|받아|사\s*와|전화|보내|챙겨|\bcall\b|bring|\bbuy\b|pick up|remind|\bsend\b|\btake\b|need to|have to|\bmust\b|remember to|don'?t forget|make sure|should (?:call|buy|bring|send|get)|\bget (?:the|some|a)\b|\bpay\b|renew|refill/i;
const KO_NAME = /(?<![가-힣])([가-힣]{1,2}\s?(?:선생님|씨|님|교수님|원장님|약사님))/g;
const KIN = /(?<![가-힣])(엄마|아빠|딸|아들|며느리|사위|손주|손자|손녀|할머니|할아버지)(?![가-힣]{2})/g;
const EN_NAME = /\b((?:Dr\.?\s+|Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+)?[A-Z][a-z]{2,})\b/g;
const STOP = new Set(('Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December '
  + 'Can Could Would Should Shall Will The This That These Those What When Where Who Whom How Why Please Yes Okay Sounds Let Lets Actually Maybe Then And But Also Today Tomorrow Tonight Yesterday '
  + 'Next Last Nov Dec Jan Feb Mar Apr Jun Jul Aug Sep Oct Good Mom Dad Mum Grandma Grandpa Bring Meet Call Pick Remember Dont Here There Hello Hey Thanks Thank Great Perfect Sure Sorry Well '
  + 'Cancel Move Moved Take Send Get Buy Book Add Remind Tell Ask See Still Just Any Are Did Does Have Has Had Not Never Forget Make Sunday Noon Midnight Morning Afternoon Evening Night '
  + 'Unknown Someone Anyone Everyone Nobody Instead Ignore Confirm Confirmation Notice Instructions Instruction System Assistant Delete Reply Wait Hold Keep Try Give Put Set Use').split(' '));
const KO_PLACE = /(?:[가-힣]{1,2}\s?선생님\s)?[가-힣]*(?:병원|약국|경로당|복지관|센터|교회|시장|마트|공원|식당)/;
const PLACE_WORDS = 'hospital|clinic|pharmacy|center|centre|park|market|restaurant|church|home|studio|library|cafe|caf\u00e9|school|gym|pool|hall|office|store|shop|station|garden|greenhouse|room|house|theater|theatre|museum|salon|bakery|kitchen|community center|senior center|temple|mall|airport|bank';
const EN_PLACE = new RegExp(`\\b(?:at|in|to)\\s+((?:the\\s+)?[A-Za-z' ]{2,30}?(?:${PLACE_WORDS}))\\b`, 'i');
const EN_PLACE_PROPER = /\b(?:at|in)\s+((?:the\s+)?[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,3})\b(?!\s*(?:\d|:))/;

function clauses(text) {
  const out = []; const re = /[^.?!。,，]+/g; let m;
  while ((m = re.exec(text))) {
    const raw = m[0]; const lead = raw.length - raw.trimStart().length; const t = raw.trim();
    if (t) out.push({ start: m.index + lead, text: t });
  }
  return out;
}

const TITLE_DROP = new Set(('the a an to at on in for of and or i i\'ll i\'m we you your my our can could would will shall let\'s lets please don\'t dont forget remember actually okay ok sure yes yep '
  + 'cancel cancelled canceled push pushed move moved instead is are be it its that this with have has had do does going not no longer works work good free next last coming up back '
  + 'can\'t cant cannot won\'t about around by from then so but also just really maybe how what when where who').split(' '));
/** Short noun-ish title for the labelled FALLBACK (time words and filler removed) so cancel/replace cues can match the original thread. */
function fbTitle(text, spans, where, who) {
  let s = text;
  for (const sp of [...spans].sort((a, b) => b.start - a.start)) s = s.slice(0, sp.start) + ' ' + s.slice(sp.end);
  if (where?.name) s = s.replace(where.name, ' ');
  const toks = s.split(/[^\p{L}\p{N}'’\-]+/u).filter(Boolean).filter((w) => !TITLE_DROP.has(w.toLowerCase()) && !/^\d+(?:st|nd|rd|th)?$/i.test(w));
  const t = toks.slice(0, 6).join(' ').trim();
  return (t || text).slice(0, 80);
}
export function fallbackExtract(utterances) {
  const items = []; let n = 0;
  for (const u of utterances) {
    const utteranceAgree = AGREE.test(u.text);
    for (const c of clauses(u.text)) {
      const spans = scanTimePhrases(c.text);
      const hasEvent = EVENT_KW.test(c.text); const hasTask = TASK_KW.test(c.text);
      if (!spans.length && !hasEvent && !hasTask && !CANCEL.test(c.text)) continue;
      let cue = 'propose';
      if (CANCEL.test(c.text)) cue = 'cancel';
      else if (NEG.test(c.text) && spans.length) cue = 'negation_unavailable';
      else if (REPLACE.test(c.text) && spans.length) cue = 'replace';
      else if (utteranceAgree && spans.length) cue = 'agree';
      let kind = hasEvent || (spans.length && !hasTask) ? 'event' : 'task';
      if (cue === 'negation_unavailable') kind = 'fact';
      let where = null;
      const km = c.text.match(KO_PLACE); const em = c.text.match(EN_PLACE); const pm = c.text.match(EN_PLACE_PROPER);
      if (km) where = { name: km[0].trim(), quote: km[0].trim(), utterance: u.index };
      else if (em) where = { name: em[1].trim(), quote: em[1].trim(), utterance: u.index };
      else if (pm && !STOP.has(pm[1].replace(/^the\s+/i, '').split(' ')[0])) where = { name: pm[1].trim(), quote: pm[1].trim(), utterance: u.index };
      const who = []; const seen = new Set();
      const addWho = (name) => { if (!seen.has(name) && !(where && where.name.includes(name))) { seen.add(name); who.push({ name, quote: name, utterance: u.index }); } };
      for (const m of c.text.matchAll(KO_NAME)) addWho(m[1]);
      for (const m of c.text.matchAll(KIN)) addWho(m[1]);
      for (const m of c.text.matchAll(EN_NAME)) if (!STOP.has(m[1].replace(/^(?:Dr|Mr|Mrs|Ms)\.?\s+/, ''))) addWho(m[1]);
      const title = fbTitle(c.text, spans, where, who);
      items.push({
        ref: `fb${++n}`, kind, cue, title: { ko: title, en: title }, quote: c.text, utterance: u.index,
        who, when: spans.map((s) => ({ quote: s.text, utterance: u.index })), where, what: null, target: null, confidence: 'stated',
      });
    }
  }
  return { items };
}
