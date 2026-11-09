// Static capability/roadmap list (honest labels). `label` is a capability-status key (cap.* strings).
// Labels here describe the UI build as of writing; update only with evidence (qa/ runs), never optimistically.
//   demonstrated = ran end to end in this build with evidence (set only after QA evidence exists)
//   designed     = specified, not working
//   unverified   = code may exist, not tested end to end
//   simulated    = fake/fixture logic behind a believable screen
//   roadmap      = future, nothing works

export const CAPABILITIES = [
  { key: 'cap.i1', label: 'unverified' },   // model route health is shown live in the chip; no QA evidence yet
  { key: 'cap.i2', label: 'unverified' },
  { key: 'cap.i3', label: 'unverified' },
  { key: 'cap.i4', label: 'unverified' },
  { key: 'cap.i5', label: 'simulated' },
  { key: 'cap.i6', label: 'simulated' },
  { key: 'cap.i7', label: 'roadmap' },
  { key: 'cap.i8', label: 'designed' },
  { key: 'cap.i9', label: 'roadmap' },
  { key: 'cap.i10', label: 'roadmap' },
  { key: 'cap.i11', label: 'roadmap' },
  { key: 'cap.i12', label: 'unverified' },
  { key: 'cap.i13', label: 'unverified' },   // adapted from bridge speak(); Korean voice availability depends on the device
  { key: 'cap.i14', label: 'unverified' },
];

export const RECEIPT_STORE_ORDER = [
  'transcript', 'memories', 'search_index', 'proposals', 'action_ledger', 'notification_queue', 'llm_cache', 'exported_file', 'external_calendar',
];
