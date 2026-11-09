// notification.preview: a PURE list of what reminders would look like. It never sends anything and is not an
// operating-system notification (mode 'simulated', claimStatus 'simulated'). Owner: sj-actions.
import { toKstIso, displayOffset, displayDateTime } from './format.mjs';

export function createNotificationPreview() {
  return {
    describe: () => ({
      id: 'notification.preview', kind: 'notification', mode: 'simulated',
      label: { ko: '알림 미리보기 (실제 알림 아님)', en: 'Notification preview (not a real notification)' },
      claimStatus: 'simulated', maxVerifyLevel: 'none',
      notes: 'Pure preview list. No Notification API, no push, no server.',
    }),
    /** @param {{ title:string, who:string|null, startMs:number, reminders:number[], nowMs:number }} f */
    build(f) {
      const when = displayDateTime(f.startMs);
      return f.reminders.map((min) => {
        const fireMs = f.startMs - min * 60000;
        const off = displayOffset(min);
        return {
          adapterId: 'notification.preview',
          mode: 'simulated',
          badge: { ko: '미리보기', en: 'PREVIEW' },
          offsetMin: min,
          fireAt: toKstIso(fireMs),
          inPast: fireMs < f.nowMs,
          title: { ko: f.title, en: f.title },
          body: {
            ko: `${off.ko}: ${f.who ? f.who + '님과 ' : ''}${f.title} - ${when.ko}`,
            en: `${off.en}: ${f.title}${f.who ? ' with ' + f.who : ''} - ${when.en}`,
          },
        };
      });
    },
  };
}
