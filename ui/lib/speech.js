// Browser read-aloud (TTS) and optional speech input. Text is ALWAYS shown; voice is an extra.
//
// REUSE: speak() is adapted from E:\jarvis-aside-bridge\index.html line 487 (sha256 recorded in REUSE-MANIFEST):
//   function speak(t){ try{ if(!window.speechSynthesis) return; var u=new SpeechSynthesisUtterance(t);
//                       u.lang='ko-KR'; speechSynthesis.cancel(); speechSynthesis.speak(u);}catch(e){} }
// Changes for EBYS: ES module + injectable globals for tests; language follows the UI (ko-KR / en-US);
// slower rate (0.9) for older listeners; returns whether speech started; onend/onerror callbacks; voice
// availability check; stop(); the on/off preference is NOT persisted (bridge used localStorage).
// Speech INPUT is new code (the bridge uses a server STT service, not browser recognition).

const g = () => globalThis;

export const speechLang = (lang) => (lang === 'en' ? 'en-US' : 'ko-KR');

export function ttsAvailable() {
  return typeof g().speechSynthesis !== 'undefined' && typeof g().SpeechSynthesisUtterance !== 'undefined';
}

/** 'yes' | 'no' | 'unknown' (voices load lazily in some browsers). Unverified until tried on the demo device. */
export function voiceFor(lang) {
  if (!ttsAvailable()) return 'no';
  const voices = g().speechSynthesis.getVoices?.() ?? [];
  if (!voices.length) return 'unknown';
  const prefix = speechLang(lang).slice(0, 2).toLowerCase();
  return voices.some((v) => String(v.lang).toLowerCase().startsWith(prefix)) ? 'yes' : 'no';
}

export function speak(text, lang, { onend } = {}) {
  try {
    if (!ttsAvailable() || !text || !String(text).trim()) return false;
    const Utterance = g().SpeechSynthesisUtterance;
    const u = new Utterance(String(text));
    u.lang = speechLang(lang);
    u.rate = 0.9;
    u.onend = () => onend?.();
    u.onerror = () => onend?.();
    g().speechSynthesis.cancel();
    g().speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  try { if (ttsAvailable()) g().speechSynthesis.cancel(); } catch { /* ignore */ }
}

// ---- optional speech input (labelled unverified; shown only if the browser has it) ----
export function recognitionCtor() {
  return g().SpeechRecognition ?? g().webkitSpeechRecognition ?? null;
}

let active = null;

/** Starts recognition; never auto-sends. Calls onText(finalText) once, then onEnd(). Returns false if unsupported. */
export function startListening(lang, { onText, onEnd, onError }) {
  const Ctor = recognitionCtor();
  if (!Ctor) return false;
  stopListening();
  const rec = new Ctor();
  rec.lang = speechLang(lang);
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let text = '';
  rec.onresult = (e) => { text = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim(); };
  rec.onerror = (e) => onError?.(e.error ?? 'error');
  rec.onend = () => { active = null; if (text) onText?.(text); onEnd?.(); };
  active = rec;
  try { rec.start(); } catch (e) { active = null; onError?.(String(e?.message ?? e)); onEnd?.(); return false; }
  return true;
}

export function stopListening() {
  try { active?.stop(); } catch { /* ignore */ }
}
