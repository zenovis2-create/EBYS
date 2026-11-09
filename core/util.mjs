import { createHash } from 'node:crypto';
import { seoulParts, ymd } from './time.mjs';

export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const shortHash = (s, n = 12) => sha(s).slice(0, n);

const UNKNOWN_LABEL = /^(unknown|unk|\?+|알 ?수 ?없음|모름|누군가|someone|stranger|unidentified|unknown speaker|unknown voice|unknown caller|anonymous|n\/a)$/i;
const NUMBERED_UNKNOWN = /^(speaker|화자|voice)\s*#?\s*(\d+)$/i;

export function detectLang(text) {
  const h = (text.match(/[\u3131-\u318e\uac00-\ud7a3]/g) || []).length;
  const l = (text.match(/[A-Za-z]/g) || []).length;
  if (h === 0) return 'en';
  if (l === 0) return 'ko';
  if (h >= 3 && l >= 3) return 'mixed';
  return h >= l ? 'ko' : 'en';
}

const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'x';

/**
 * Split "Speaker: text" lines. Unlabelled lines => unknown speaker. Optional "[HH:MM]" prefix.
 * Returns utterances WITHOUT ids (assigned by the store).
 */
export function splitTranscript(text, nowIso) {
  const now = seoulParts(nowIso);
  const today = ymd(now.y, now.m, now.d);
  const base = Date.parse(nowIso);
  const out = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let ts = null; let label = null; let body = line;
    const m = line.match(/^(?:[[(]\s*(\d{1,2}):(\d{2})\s*[\])]\s*)?([^:：\n]{1,40}?)\s*[:：]\s*(\S.*)$/u);
    if (m) {
      const cand = m[3].trim();
      const ok = /[\p{L}]/u.test(cand) && !/^\d+$/.test(cand) && !/[?!]/.test(cand) && cand.split(/\s+/).length <= 6;
      if (ok) { label = cand; body = m[4].trim(); if (m[1]) ts = [Number(m[1]), Number(m[2])]; }
    }
    if (ts === null) {
      const t = body.match(/^[[(]\s*(\d{1,2}):(\d{2})\s*[\])]\s*(.+)$/);
      if (t) { ts = [Number(t[1]), Number(t[2])]; body = t[3]; }
    }
    let speakerKnown = false; let speakerId = 'spk_unknown'; let speakerLabel = 'Unknown speaker';
    if (label && !UNKNOWN_LABEL.test(label)) {
      const n = label.match(NUMBERED_UNKNOWN);
      if (n) { speakerId = `spk_unknown#${n[2]}`; speakerLabel = `Unknown speaker ${n[2]}`; }
      else { speakerKnown = true; speakerId = `spk_${slug(label)}`; speakerLabel = label; }
    }
    const idx = out.length;
    const startedAt = ts
      ? `${today}T${String(ts[0]).padStart(2, '0')}:${String(ts[1]).padStart(2, '0')}:00+09:00`
      : toSeoulIso(base + idx * 1000);
    out.push({ index: idx, speakerId, speakerLabel, speakerKnown, text: body, startedAt, lang: detectLang(body) });
  }
  return out;
}

function toSeoulIso(ms) {
  const p = seoulParts(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${ymd(p.y, p.m, p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(new Date(ms + 9 * 3600e3).getUTCSeconds())}+09:00`;
}

export function tokens(s) {
  const out = new Set();
  const low = String(s ?? '').toLowerCase();
  for (const w of low.split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    out.add(w);
    if (/[\u3131-\u318e\uac00-\ud7a3]/.test(w) && w.length >= 2) for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}
export function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
export const normName = (s) => String(s ?? '').toLowerCase().replace(/[\s.\-_]+/g, '');
