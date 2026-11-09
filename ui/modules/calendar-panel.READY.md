# calendar-panel: READY (module only, not wired in)

Files (all NEW, nothing existing was edited):
- `ui/modules/calendar-panel.js` (vanilla DOM via `ui/lib/dom.js`, no framework, no innerHTML)
- `ui/modules/calendar-panel.css` (every selector starts with `.sjcal`; link it from `index.html` or import it, integrator's choice)
- `ui/test/calendar-panel.test.mjs` (15 tests, pass: `node --test ui/test/calendar-panel.test.mjs`)

## Integration contract

```js
import { renderCalendarPanel } from './modules/calendar-panel.js';

const panel = renderCalendarPanel({
  events,                       // array exactly as stored by adapters/calendar-local.mjs listEvents()
  onRefresh: async () => { panel.update(await loadEvents()); },  // Refresh button; throw to show an error
  onCreate:  (day) => {},       // day = 'YYYY-MM-DD' selected in the panel; open your add-event flow
  onEdit:    (event) => {},     // raw stored event (has .uid, .id, .start ...)
  onDelete:  async (event) => { await api.remove(...); panel.update(await loadEvents()); }, // runs only after the panel's own "Yes, delete"
  status: 'Loaded from this device', // optional
});
mount.append(panel);            // panel is an HTMLElement
// panel.update(events) | panel.setError('text'|null) | panel.setLoading(bool) | panel.select('YYYY-MM-DD')
```

Every callback is optional; its button is simply not rendered when absent. A callback that throws/rejects shows a red alert inside the panel and keeps the event.

## Event shape read (real store fields)

`title`, `start` ("YYYY-MM-DDTHH:mm" Seoul wall time, or "YYYY-MM-DD" when all-day), optional `end`, `allDay`, `location`, `who`, `type` (appointment|deadline|followup|reminder), `uid`/`id`, `startsAt` (must agree with `start`, otherwise the row shows a warning like the store's own readback rule), `reminders`.
Entries with no readable date are counted in a visible notice, never silently dropped.

## Behaviour

- Month: read-only 6x7 grid (cells ~48px at 390px width, so not tap targets) with per-day event counts. Prev/Next month buttons are 56px.
- Day: 56px Prev day / Next day / Today / native date picker / "+ Add event". Lists that day's events.
- Saved events: ALL stored events, Upcoming (soonest first) then Past (latest first), shown even when the current month is empty. Empty store shows an honest empty message.
- Time: Asia/Seoul. "Today" and "now" use `Intl` with `timeZone: 'Asia/Seoul'`; event wall times are never converted through the device timezone. 12-hour AM/PM labels. English only.
- Delete: in-panel two-step ("Delete" -> "Yes, delete" / "Keep it"), no `window.confirm`.

## GAP the integrator must close (I did not touch server/UI files)

`server.mjs` currently exposes NO route that returns calendar events (`/api/records` returns action records only, not stored events). To feed the panel real data you need, in the owner's files:
1. a read-only `GET /api/calendar/events` returning `{ ok:true, data:{ events: adapter.listEvents() } }` (the `calendar.local` adapter already has `listEvents()`; only meaningful with `EBYS_CALENDAR=local`; with `simulated` return an empty list or a clear "calendar is simulated" state, do not invent events),
2. a `liveApi.calendarEvents()` wrapper in `services/liveApi.js` (fetch is only allowed there by `ui.test.mjs`).
Edit/delete should go through the existing confirm/delete flow (`/api/delete`, the proposal flow), since only that path writes with readback.

Source reuse: layout/behaviour patterns follow the READ-ONLY bridge calendar in `E:/jarvis-aside-bridge/index.html` (month nav, 6-row grid, day list); no `calendar.json` or private data was read or copied.

## Test note

`ui/test/ui.test.mjs` currently fails one test ("fetch only in liveApi.js") because of `ui/modules/phone-task-panel.js`, which is not mine; the calendar module contains no `fetch(`.
