// Canonical JSON for the FIXTURE digest only. Real preview digests are computed server-side
// (CONTRACTS 6a R01); the UI never computes or alters a real digest, it only echoes it back.

export function canonicalJsonLocal(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonLocal).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJsonLocal(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
