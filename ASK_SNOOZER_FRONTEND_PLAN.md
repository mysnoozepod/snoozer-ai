# Ask Snoozer Frontend Plan

Primary route: `omnia-journey/src/pages/AskSnoozer.jsx`

## Current frontend structure

- route component: `AskSnoozer.jsx`
- request helper: `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
- cart badge source: Zustand `snoozepod`
- layout shell: showroom primitives
- transcript state: local component state
- chat send path: `sendAskSnoozerMessage()`

## Current request payload shape

`sendAskSnoozerMessage()` posts to `POST /ask-snoozer` with:

- `message`
- `conversationId`
- `surface: "react_app"`
- `mode: "ask_snoozer_page"`
- `page.route`
- `page.referrerRoute`
- `identity` including `shopperId` and session id
- `context` built from stored assessment/recommendations/session/cart data
- `history`
- `client`
- plus transport-level `thread_id`, `shopperId`, `sessionId`

## Current response handling

The page already handles:

- assistant text/reply
- chips
- actions
- recommendation cards
- retry prompts
- local fallback assistant messages on error
- optional HUD voice replay through layout context

## Current layout sections

- top rail with brand + cart badge
- hero/header with Snoozer avatar, title, helper copy, top CTAs
- transcript panel
- empty-state helper inside transcript
- assistant/user bubble rendering
- chip/action/recommendation renderers inside transcript
- sticky-ish composer zone near the bottom of the panel
- footer CTAs back to results/human help

## Current risks

- the page is still too layout-heavy for a simple chat surface
- transcript and composer ownership are easy to clip or overlap
- top-level CTAs, starter chips, footer actions, and transcript all compete for height
- chat rendering is custom enough that small layout tweaks can hide the actual conversation

## Recommended target structure

1. top logo/header shell
2. single centered chat container
3. compact Snoozer identity row
4. composer/input near the top, ChatGPT-style
5. no more than five starter chips
6. transcript directly below the composer
7. transcript owns its own scroll area
8. footer stays compact and owns Talk to Human / View Results only

## Recommended component split

- `omnia-journey/src/components/ask-snoozer/AskSnoozerShell.jsx`
- `omnia-journey/src/components/ask-snoozer/AskSnoozerHeader.jsx`
- `omnia-journey/src/components/ask-snoozer/AskSnoozerComposer.jsx`
- `omnia-journey/src/components/ask-snoozer/AskSnoozerTranscript.jsx`
- `omnia-journey/src/components/ask-snoozer/AskSnoozerMessage.jsx`
- `omnia-journey/src/components/ask-snoozer/AskSnoozerStarterChips.jsx`

## Next-pass rule

The `/ask-snoozer` page should become input + output first. Everything else is secondary.
