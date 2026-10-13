# TripPlanner

An offline trip guide for the phone. An AI writes the trip as a JSON file, the app
validates it and shows each day as a timeline that follows the clock. It is an
installable web app (PWA) published with GitHub Pages at
https://cmirassepu.github.io/TripPlanner/.

It is being built for one real trip first. Once that trip has tested it, the format
gets written up as a set of rules an AI can follow for any trip.

**This repo is public.** Nothing personal goes in it: no bookings, names, dates of
travel or documents.

## Priorities

1. **The trip plan comes before the app.** A finished plan with a half-built app is
   fine; the reverse is not. The plan must stay printable at every stage.
2. App features are built when the plan needs them, not ahead of time.

## Decisions already made

Do not reopen these unless the user does.

- **Web app, not a native iOS app.** A native build signed with a free Apple ID stops
  working after 7 days. A native shell was discussed and parked.
- **A guide, not a diary.** There is no marking of stops, no "unplanned stop" and no
  free mode. The "now" line on the day screen is driven by the clock alone. The
  journal modules under `src/journal/` are still there and tested, but no screen
  uses them.
- **Simple screens, detail one tap away.** The day screen shows one line per stop:
  time, name, and the deadline that matters. Everything else lives on the stop's own
  page. The test for the day screen is "do I need this to act in the next hour?".
- **English only**, for the app's labels and for trip content. Validator messages,
  code comments and commit messages are in Spanish; keep writing those in Spanish.
- **Photos are embedded in the trip file** as `data:image/...` URIs so they work
  offline. Use freely licensed sources and always fill in `photo.credit`.

## Where things live

| What | Where |
|---|---|
| App code, tests, spec | This repo |
| Real trip file, guidebook, anything personal | The iCloud Drive folder `TripPlanner-Private`, added to the session as an extra directory |
| The copy the app uses | Inside the installed app on the phone, loaded with "Load trip file" |

- Real trip files never go in the repo. `.gitignore` blocks `private/`,
  `*.private.json`, `*thailand*` and `*tailandia*`.
- To try a real trip file in the browser, copy it into `web/data/` (ignored by git)
  and delete it again when done.
- Do not read the sibling folder `../Thailand-2026`. It is an earlier attempt and the
  user wants this project planned fresh, without carrying its choices over.
- The repo itself must not live in iCloud Drive. It syncs between machines through
  GitHub: pull at the start of a session, push at the end.

## Commands

```bash
npm install        # once per machine
npm test           # all tests (Node runs the TypeScript directly)
npm run typecheck
npm run build      # writes web/app.js, app.css, sw.js and icons
npm run sevilla    # full pass over the Sevilla sample trip
```

Preview with the `guia-viaje` configuration in `.claude/launch.json` (port 5173),
not by running the server from a shell. The service worker caches the app, so after
a rebuild unregister it and clear caches before trusting what the browser shows.

Pushing to `main` runs the tests and typecheck and, if they pass, publishes to
GitHub Pages. The phone picks the new version up the next time the app is closed
and reopened.

## Code map

The core is plain TypeScript with no runtime dependencies and no framework.

```
src/model/     the trip file format (types)
src/core/      time arithmetic, the day's schedule, opening hours, alerts
src/validate/  checks a trip file and reports every problem in one pass
src/patch/     surgical changes to a trip, and the diff between versions
src/render/    a day as a standalone HTML page (the printable fallback) and the styles
src/ui/        the app: routes and state, screens, event handling
src/store/     IndexedDB storage and install detection
src/sw/        the service worker
```

The data flows trip file → validator → schedule → screen. `Prep Docs/` holds the
original spec (in Spanish, partly out of date against the code) and the Sevilla
sample files the tests run against.

## Working with the user

- Plain language, no jargon without explaining it.
- Setup steps one at a time, not as a list.
- Explanatory output style for app work, so changes come with a short explanation of
  how they work. Trip planning goes at full speed without it.
- Verify changes in the browser at phone size before saying they work, and say
  plainly what was not checked on the real phone.
