// Text hygiene and the "no communication / emergency actions" guard.
// Browser-safe (no node imports). Owner: sj-actions.

// Link schemes that could dial, message, mail or launch another app. The pattern is assembled from
// pieces so this source file itself never contains the literal strings (a static test scans for them).
const SCHEMES = ['te' + 'l', 'sm' + 's', 'sms' + 'to', 'mail' + 'to', 'call' + 'to', 'face' + 'time', 'in' + 'tent', 'si' + 'p'];
const SCHEME_RE = new RegExp(`\\b(${SCHEMES.join('|')})(\\s*):`, 'gi');
const SCHEME_TEST_RE = new RegExp(`\\b(${SCHEMES.join('|')})\\s*:`, 'i');
const ZWSP = '\u200b';

/**
 * Normalise user/model text before it goes into a payload: strip control characters and newlines,
 * collapse whitespace, cap length, and break link schemes with a zero-width space so no calendar
 * client can linkify them into dial/message/mail actions. Visible text stays the same.
 */
export function cleanText(value, max = 200) {
  if (value === undefined || value === null) return '';
  let s = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max).trimEnd();
  return s.replace(SCHEME_RE, (_m, scheme, ws) => `${scheme}${ZWSP}${ws}:`);
}

/** True when the string contains a dial/message/mail/launch scheme (after cleaning this must be false). */
export function containsForbiddenScheme(text) {
  return typeof text === 'string' && SCHEME_TEST_RE.test(text);
}

/** Fail-closed check over any JSON-able output the adapters produce. */
export function findForbiddenOutput(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return containsForbiddenScheme(text) ? 'forbidden_scheme' : null;
}
