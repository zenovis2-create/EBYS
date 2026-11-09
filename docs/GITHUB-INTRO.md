# GitHub intro

Text for the repository description, topics and a short introduction. Facts only, with limits stated.

## Repository description (one line)

Ever by your side: a conversation memory for older adults. A real model answers from verbatim quotes, asks AM or PM when unsure, and saves plans only after you confirm.

## Suggested topics

`older-adults`, `accessibility`, `memory-assistant`, `llm`, `human-in-the-loop`, `nodejs`, `hackathon`

## Short introduction

Plans get lost in conversations: who is coming, which day, what time, where. EBYS is a mobile-first web app that remembers them. You paste a conversation and ask a question. A real model (Cursor CLI, Claude Sonnet 5.5) answers, and each answer is tied to the exact words that were said.

- **No invented facts.** If it was not said, EBYS answers "I don't have that."
- **No guessing on time.** If an hour could be morning or evening, EBYS asks "Is that AM or PM?"
- **You decide.** EBYS shows a preview first. Nothing is saved until you confirm, and Cancel is always there.
- **Saved and checked.** A confirmed plan is written to the EBYS calendar on your PC, a local JSON file, and then read back through the API to check it.

## Honest scope

- The calendar is a file on the computer running EBYS. It is not a phone calendar, and there are no OS notifications.
- Typed text is the tested input. Browser voice is optional and unverified.
- No real calls, messages, emergency calling, safety monitoring, watch, glasses or 24-hour audio.
- All demo data is synthetic.
- Built in one day at c0mpiled-17 (Seoul, 2026-11-09). Security and privacy review is not complete.

## Where to go next

- [README](../README.md): what works, what does not, and how to run it
- [SETUP.md](SETUP.md): Node 24, Cursor CLI, modes and calendar
- [DEMO.md](DEMO.md): step-by-step walkthrough
- [Independent QA review](../qa/evidence/targeted-local-2026-11-09T04-42-20-836Z-180200/REVIEW.md)

## Demo video

Pending. The link will be added after the final video is approved.
