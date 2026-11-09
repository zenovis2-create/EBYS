# EBYS submission copy (English draft)

**Historical English copy draft.** The repository is now public: https://github.com/zenovis2-create/EBYS. The official submission was recorded on 2026-11-09 at 15:03 KST using the form description and [90-second demo](https://www.youtube.com/watch?v=_Ante-RR464), not this entire draft.

Claims below are only the facts the lead marked verified.

## One line

EBYS reads a synthetic English conversation and answers who, when, and where from the words that were said, then saves a plan only after you confirm it.

## Hackathon description

EBYS is for a plan that is easy to lose. A real model (Cursor CLI, Claude Sonnet 5.5) reads a synthetic English conversation. It answers who, when, and where, and each answer uses a verbatim quote from that conversation. If the fact is not there, it says it does not have that. If the time could be morning or evening, it asks “AM or PM?” instead of guessing.

Every save shows a preview first. Nothing is stored until you confirm. A confirmed appointment is written to the EBYS calendar on this device, which is a local file, and then read back to check. That file is not the phone’s calendar. Reminders stay inside the app. They are not phone notifications.

The app is English by default. Korean is optional. Times are shown in Seoul time (UTC+9). All data is synthetic.

Watch, 24-hour audio, glasses, safety, and 119 are roadmap and mockup only. They do not work in this build.

## Truth matrix

| Topic | Say this | Do not say this |
| --- | --- | --- |
| Real AI | Cursor CLI with Claude Sonnet 5.5 reads a synthetic English conversation and answers who, when, and where with verbatim source quotes. | Any other model, a live phone call, or a non-synthetic recording. |
| Missing facts | It says “I don’t have that.” It asks “AM or PM?” instead of guessing. | A filled-in place, person, or time that was never said. |
| Save | Every save shows a preview and needs an explicit confirmation. | A save with no preview, or a save on the first tap. |
| Calendar | A confirmed appointment is written to the EBYS calendar on this device (a local file) and read back. Reminders are in-app. | The phone calendar, a cloud calendar, or a phone notification. |
| Language and time | English by default, Korean optional. Times show Seoul time (UTC+9). | A claim that the interface is Korean-only, or that times are shown in another zone. |
| Data | All data is synthetic. | Customers, revenue, health outcomes, or real people’s records. |
| Not in this build | Watch, 24-hour audio, glasses, safety, and 119 are roadmap or mockup only. | That any of those work. |

## Known limits

- The calendar that is verified is the EBYS file on this device, not the phone operating system.
- Reminders are in-app only.
- Watch, 24-hour audio, glasses, safety, and 119 are not working features.
- This copy remains a historical draft, not a claim of broader phone integration or full-product acceptance.
