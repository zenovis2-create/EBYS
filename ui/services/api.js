// Selects the API implementation. Default = SYNTHETIC/SIMULATED fixture; ?api=live uses the lead server.
import { liveApi } from './liveApi.js';
import { createFixtureApi } from './fixtureApi.js';

export function selectApi(search = '') {
  const q = new URLSearchParams(search);
  if (q.get('api') === 'live') return liveApi;
  return createFixtureApi({ fault: q.get('fault'), latency: q.get('fast') === '1' ? 0.05 : 1 });
}
