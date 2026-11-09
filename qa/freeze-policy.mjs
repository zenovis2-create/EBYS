// Pure offline guards. Importing this module never contacts the server.
export function parseFreezeSignal(text) {
  const match = /^LEAD-READY-FREEZE ([a-f0-9]{12}) ([a-f0-9]{12})$/i.exec(text ?? '');
  if (!match) throw new Error('Exact LEAD-READY-FREEZE <server sha12> <ui sha12> signal required');
  return { server: match[1].toLowerCase(), ui: match[2].toLowerCase() };
}
export function freezeErrors(runtime, expected, anchor) {
  const s = runtime?.sourceSnapshot, errors = [];
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  if (!hex(s?.serverLoaded?.sha256) || !s.serverLoaded.sha256.startsWith(expected.server)) errors.push('server signal hash mismatch');
  if (!hex(s?.uiOnDisk?.sha256) || !s.uiOnDisk.sha256.startsWith(expected.ui)) errors.push('UI signal hash mismatch');
  if (s?.serverCurrent !== true || s?.serverLoaded?.sha256 !== s?.serverOnDisk?.sha256) errors.push('loaded server differs from disk');
  if (!Number.isFinite(Date.parse(s?.serverLoaded?.startedAt))) errors.push('loaded startedAt missing');
  if (!runtime?.version || runtime?.mode !== 'real' || runtime?.calendar?.kind !== 'ebys_local'
    || !runtime?.adapters?.some(a => a.id === 'calendar.local' && a.mode === 'real')) errors.push('runtime version/local calendar missing');
  if (anchor && (s?.serverLoaded?.sha256 !== anchor.sourceSnapshot.serverLoaded.sha256
    || s?.serverLoaded?.startedAt !== anchor.sourceSnapshot.serverLoaded.startedAt
    || s?.uiOnDisk?.sha256 !== anchor.sourceSnapshot.uiOnDisk.sha256 || runtime.version !== anchor.version)) errors.push('freeze changed during run');
  return errors;
}
export function authorizeScopedDelete(payload, owned, runtime, anchor, runId, protectedSessionIds = new Set()) {
  if (!payload || Object.keys(payload).length !== 1 || typeof payload.sessionId !== 'string') throw new Error('Only {sessionId} is allowed; no all field');
  const entry = owned.get(payload.sessionId);
  if (!entry || entry.runId !== runId || entry.createdHere !== true || entry.duplicate !== false) throw new Error('Session is not owned by this freeze run');
  if (protectedSessionIds.has(payload.sessionId)) throw new Error('Persistent baseline event uses this session ID; scoped deletion could affect another run');
  if (runtime?.sourceSnapshot?.serverLoaded?.sha256 !== anchor?.sourceSnapshot?.serverLoaded?.sha256
    || runtime?.sourceSnapshot?.serverLoaded?.startedAt !== anchor?.sourceSnapshot?.serverLoaded?.startedAt) throw new Error('Backend identity changed; never delete potentially reused session IDs');
  return payload.sessionId;
}
export function receiptErrors(receipt, sessionId) {
  const errors = [];
  if (receipt?.scope !== `session:${sessionId}`) errors.push('wrong receipt scope');
  for (const name of ['transcript', 'memories', 'search_index', 'proposals', 'action_ledger', 'llm_cache']) {
    if (!receipt?.stores?.some(s => s.name === name && ['verified_deleted', 'not_applicable'].includes(s.status))) errors.push(`${name} deletion not verified`);
  }
  if (receipt?.allVerified !== true || receipt?.stores?.some(s => !['verified_deleted', 'not_applicable'].includes(s.status))) errors.push('receipt contains unverified copies');
  return errors;
}
export function sourceValueErrors(answer) {
  const errors = [], normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (const key of ['who', 'where']) {
    const slot = answer?.slots?.[key];
    if (slot?.state !== 'known') continue;
    const values = key === 'who' ? (Array.isArray(slot.value) ? slot.value.map(v => v.name ?? v) : [slot.value?.name ?? slot.value]) : [slot.value?.name ?? slot.value];
    if (!values.length) errors.push(`${key} known value is empty`);
    for (const value of values) if (!value || !slot.evidence?.some(e => normalize(e.quote).includes(normalize(value)))) errors.push(`${key} value not bound to its quote`);
  }
  return errors;
}
export function modelBudgetMs(now, deadline) {
  if (!Number.isFinite(now) || !Number.isFinite(deadline) || now + 300_000 > deadline) throw new Error('Insufficient time for one bounded model call plus two-minute cleanup reserve');
  return 180_000;
}
