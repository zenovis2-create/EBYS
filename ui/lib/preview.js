// Normalise a /api/preview response into ONE flat shape the screens read.
// Real server: { proposalId, revision, preview:{ fields, display, summary, modeLabel, warnings, notifications, mode, adapterId, previewDigest }, previewDigest }
// Legacy/sample: a flat preview object. Both are accepted. The digest is passed back unchanged (never recomputed here).

export function normalizePreview(d) {
  if (!d || typeof d !== 'object') return null;
  const pv = d.preview && typeof d.preview === 'object' ? d.preview : d;
  const f = pv.fields && typeof pv.fields === 'object' ? pv.fields : pv;
  const reminders = Array.isArray(f.reminders) ? f.reminders : Array.isArray(f.remindOffsetsMin) ? f.remindOffsetsMin : [];
  return {
    kind: f.kind ?? pv.kind,
    title: f.title,
    who: f.who ?? undefined,
    where: f.where ?? undefined,
    startsAt: f.startsAt,
    reminders,
    tz: f.tz,
    display: pv.display ?? null,
    summary: pv.summary ?? null,
    modeLabel: pv.modeLabel ?? null,
    warnings: Array.isArray(pv.warnings) ? pv.warnings : [],
    notifications: Array.isArray(pv.notifications) ? pv.notifications : null,
    duplicateOf: pv.duplicateOf ?? d.duplicateOf ?? null,
    mode: d.mode ?? pv.mode,
    adapterId: d.adapterId ?? pv.adapterId,
    previewDigest: d.previewDigest ?? pv.previewDigest ?? d.digest ?? null,
  };
}
