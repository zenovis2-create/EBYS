// Preview digest: sha256(canonicalJson(consequential fields)). Owner: sj-actions.
// This file is browser-safe (async WebCrypto, available in Node 24 too). The server path in
// action-service.mjs uses node:crypto synchronously and must produce identical hex (tested).
import { canonicalJson } from '../contracts/contracts.js';

/** The exact object that is hashed. Everything the user sees and is consenting to is in here. */
export function digestPayload({ intentId, revision, kind, title, who, startEpoch, durationMin, where, reminders, adapterId, mode, tz }) {
  return {
    intentId, revision, kind, title,
    who: who ?? null,
    startEpoch,                 // instant, so +09:00 and Z spellings of the same time agree
    durationMin,
    where: where ?? null,
    reminders: [...reminders],  // already sorted/deduped by the caller
    adapterId, mode, tz,
  };
}

export function digestString(payload) { return canonicalJson(digestPayload(payload)); }

export async function sha256HexAsync(str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function computePreviewDigestAsync(payload) { return sha256HexAsync(digestString(payload)); }
