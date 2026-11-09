// displayState() single rule. The authoritative copy is contracts/contracts.js (lead-owned).
// ui/ is served statically, so we try the server's copy first and fall back to this mirror.
// ui/test/ui.test.mjs asserts that the mirror and the authoritative copy agree.

export function displayStateLocal(record) {
  if (!record) return 'none';
  const { status, mode, verifyLevel } = record;
  if (status === 'completed') {
    if (mode === 'simulated') return 'simulated_completed';
    if (verifyLevel === 'api_readback' || verifyLevel === 'device_readback') return 'completed_external';
    if (verifyLevel === 'user_attested') return 'user_attested';
    return 'unknown_outcome';
  }
  return status;
}

export let displayState = displayStateLocal;
export let displayStateSource = 'ui-mirror';

try {
  if (typeof window !== 'undefined') {
    const mod = await import('/contracts/contracts.js');
    if (typeof mod.displayState === 'function') {
      displayState = mod.displayState;
      displayStateSource = 'contracts.js';
    }
  }
} catch {
  // server does not expose /contracts/: keep the mirror
}
