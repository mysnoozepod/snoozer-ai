# HUD Layout Persistence Map

## Current ownership

- Layout-level mount: `omnia-journey/src/Layout.jsx`
- HUD adapter: `omnia-journey/src/components/SnoozerHUD.jsx`
- HUD renderer: `omnia-journey/src/components/SnoozerPanel.jsx`
- controller hook: `omnia-journey/src/lib/snoozer/hud/useShowroomHud.js`
- voice queue: `omnia-journey/src/lib/snoozer/voice/VoiceQueueContext.jsx` and `voiceQueue.js`
- script fetch: `omnia-journey/src/lib/snoozer/hud/fetchHudScript.js` -> `POST /hud/script`
- audio fetch: `omnia-journey/src/lib/snoozer/voice/fetchHudAudio.js` -> `POST /hud/tts`

## How it currently behaves

- `Layout.jsx` provides `VoiceQueueProvider` and `SnoozerContext`.
- Guided routes such as `/welcome`, `/what-to-expect`, `/assessment`, `/results`, `/pod/:podId`, and `/ask-snoozer` are treated as “page-owned Snoozer visual” routes.
- Layout only mounts the fixed overlay HUD when the current route does **not** own the full-page Snoozer experience.
- Guided pages still call `useShowroomHud()` directly for voice jobs and script actions.

## Current page-level HUD usage

| Route | HUD usage |
| --- | --- |
| `/welcome` | `runHudAction("start_assessment", ...)` |
| `/what-to-expect` | `runHudAction("view_results" or "start_assessment", ...)` |
| `/assessment` | page-level narration and completion cues |
| `/results` | intro voice + replay through `runHudAction("view_results", ...)` |
| `/pod/:podId` | heavy pod/rest/build guidance through `say`, `sayScript`, `interruptCurrent` |
| `/ask-snoozer` | page owns the full chat UI and can still trigger HUD voice |
| `/explore-dev` | older `SnoozerHUD` usage plus legacy bars |

## Persistence risks

- the voice queue itself is centralized, but visual presentation is split between layout and page-owned chat/HUD surfaces
- guided routes can feel persistent in audio but not in UI ownership
- `SnoozerPanel.jsx` still includes its own transcript/input UI, which overlaps conceptually with page-owned chat screens
- legacy `explore-dev` keeps older HUD patterns alive

## Next-pass validation target

- keep one voice/controller owner: `Layout.jsx` + `useShowroomHud()`
- treat page-level chat as a consumer of that system, not a separate HUD system
- avoid route remount churn that clears captions or pending voice jobs unexpectedly
- verify guided routes do not duplicate the same script visually and in overlay form
