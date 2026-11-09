// Live API: talks to the lead server (/api/*). The UI never calls a model or an adapter directly.
// Every method returns { ok:true, data } | { ok:false, error:{ code, message, retryable, phase? } }.
// Envelopes are normalised defensively because the server contract is still being published
// (see change requests in the T13 report).

const CLIENT_TIMEOUT_MS = 150000; // model calls can take 10-40 s; stay well above that

async function call(method, path, body, { signal } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), CLIENT_TIMEOUT_MS);
  const onAbort = () => ctl.abort(signal.reason);
  if (signal) signal.aborted ? ctl.abort(signal.reason) : signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    if (json && json.ok === false && json.error) return { ok: false, error: json.error };
    if (!res.ok) {
      return { ok: false, error: { code: `http_${res.status}`, message: json?.error?.message ?? res.statusText, retryable: res.status >= 500 } };
    }
    return { ok: true, data: json && 'data' in json && Object.keys(json).length <= 2 ? json.data : json };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'cancelled', retryable: true } };
    const timedOut = ctl.signal.aborted;
    return { ok: false, error: { code: timedOut ? 'client_timeout' : 'network', message: String(e?.message ?? e), retryable: true } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const unwrap = (r, key) => (r.ok ? { ok: true, data: r.data?.[key] ?? r.data } : r);

export const liveApi = {
  kind: 'live',
  ingest: (args, o) => call('POST', '/api/ingest', args, o),
  memories: (o) => call('GET', '/api/memories', undefined, o).then((r) => unwrap(r, 'memories')),
  query: (args, o) => call('POST', '/api/query', args, o),
  propose: (args, o) => call('POST', '/api/propose', args, o).then((r) => unwrap(r, 'proposal')),
  updateProposal: (id, patch, o) => call('POST', `/api/proposal/${encodeURIComponent(id)}`, { patch }, o).then((r) => unwrap(r, 'proposal')),
  cancelProposal: (id, o) => call('POST', `/api/proposal/${encodeURIComponent(id)}/cancel`, {}, o).then((r) => unwrap(r, 'proposal')),
  preview: (args, o) => call('POST', '/api/preview', args, o),
  confirm: (args, o) => call('POST', '/api/confirm', args, o),
  remove: (args, o) => call('POST', '/api/delete', args, o).then((r) => unwrap(r, 'receipt')),
  runtime: (o) => call('GET', '/api/runtime', undefined, o),
};
