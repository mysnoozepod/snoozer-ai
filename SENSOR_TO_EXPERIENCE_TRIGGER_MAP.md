# Sensor to Experience Trigger Map

<!-- LIVING_STATUS_START -->
## Current Implementation Status — 2026-07-20

- The React experience adapter is implemented for Welcome presence refresh, Pod presence/occupancy, Rest Test eligibility/vacancy grace, Ask Snoozer proximity context, and passive awareness in Sleep Essentials/Checkout.
- Rest Test start/complete states now map to logical lighting and ambient-audio states.
- The physical control bridge can issue logical lighting/audio commands and consume acknowledgements/reported state.
- No customer-facing entry or exit automation was added.
- Real sensor thresholds, controller adapters, lighting/audio hardware, and commissioning behavior remain pending physical installation.
<!-- LIVING_STATUS_END -->


Status: Phase 1 architecture contract  
Scope: Mapping normalized sensor events to MySnoozePod showroom experiences  
Runtime code: not implemented in this pass

## Purpose

This document maps normalized sensor events to customer and operator experiences.

Sensor failure must never block the manual showroom journey.

Existing customer-facing HUD response contract must remain:

```json
{
  "speech": "string",
  "captions": "string",
  "state": "idle | listening | thinking | speaking | celebrate | warning",
  "priority": "low | normal | high",
  "ttlMs": 5000,
  "actions": []
}
```

Only existing HUD/Rive states are allowed:

- `idle`
- `listening`
- `thinking`
- `speaking`
- `celebrate`
- `warning`

Do not rename states.

## Trigger Principles

- Presence does not equal identity.
- Occupancy does not start a Rest Test by itself.
- Rest Test timers/reminders remain software-driven.
- Learn More remains touch-driven.
- Build Your Pod remains touch-driven.
- Checkout/cart truth remains Shopify/backend-owned.
- Sensor triggers must be suppressed so Snoozer does not repeatedly speak.

## Trigger Map

| Zone | Event | Required Conditions | Derived Event | React Behavior | HUD Behavior | Lighting Behavior | Audio Behavior | Reset Controller Behavior | Operator Behavior | Debounce | Cooldown | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `entry` | `presence_detected` | Registered shared controller; confidence acceptable | None | None customer-facing | None | None | None | None | Show backend/operator awareness only | 2s | 60s | Ignore if sensor unavailable |
| `welcome-kiosk` | `presence_detected` | Welcome kiosk active or available | None | Wake/activate Welcome kiosk | No forced speech | Optional subtle wake lighting later | None | Existing local inactivity remains | Show welcome zone active | 2s | 30s | Manual Welcome remains usable |
| `welcome-kiosk` | `presence_cleared` | Prior presence active | None | No immediate customer-facing response | None | Optional idle dim later | None | Allow existing local inactivity reset | Show welcome zone inactive | 5s | 30s | No action |
| `pod-1` to `pod-5` | `presence_detected` | Pod edge registered; matching pod zone | None | Provide proximity context only | No automatic speech by default | Activate pod lighting | No ambient change by default | Delay reset if user is near pod | Mark pod presence active | 2s | 30s | Pod app remains touch-driven |
| `pod-1` to `pod-5` | `pod_occupied` | Occupancy sensor enabled; pod not disabled; session check available | `rest_test_start_eligible` after backend/session checks | Show Rest Test can start if UI is in Rest Test context | Optional low-priority prompt only if not repeated | Maintain pod lighting | None | Delay local reset | Mark pod occupied | 2s | 60s | Manual Start Test remains available |
| `pod-1` to `pod-5` | `pod_vacated` | Prior occupied state; no active override | `rest_test_pause_eligible` or `rest_test_end_eligible` after timer/session checks | Allow pause/end eligibility; do not destroy state | Optional warning only if active Rest Test | Keep/dim based on timer decision | None | Allow timer/reminder decision; do not destroy shopper/cart state | Mark pod vacated | 3s | 60s | Timer controls remain manual |
| `pod-1` to `pod-5` | `lighting_state_changed` | Lighting output registered | None | Reflect lighting status if operator UI exists | None | Confirm state | None | None | Show lighting state | 1s | 5s | Manual lighting state unknown |
| `pod-1` to `pod-5` | `manual_override` | Staff/system source; reason present | Depends on override | Display override state if relevant | Use `warning` only if user action needed | Follow override | None | Respect blocker | Show override reason | 0s | 0s | Fall back to manual controls |
| `pod-1` to `pod-5` | `device_heartbeat` | Registered enabled device | None | No customer-facing change | None | None | None | None | Update health | 0s | 0s | Mark stale if absent |
| `pod-1` to `pod-5` | `device_fault` | Registered device | None | Show sensor unavailable only if relevant | `warning` only if user needs guidance | Safe lighting fallback | None | Do not block manual journey | Alert operator | 0s | 300s | Manual flow continues |
| `ask-snoozer` | `presence_detected` | Shared controller; confidence acceptable | None | Wake/prepare Ask Snoozer kiosk | Proximity context only; no repeated speech | None | None | Delay local reset | Show active | 2s | 60s | Ask Snoozer remains touch/input-driven |
| `sleep-essentials-zone` | `presence_detected` | Shared controller; confidence acceptable | None | Prepare curated experience when route exists | Proximity context only | None | None | Delay local reset | Show active | 2s | 60s | No product truth invented; Shopify remains truth |
| `checkout-zone` | `presence_detected` | Shared controller; confidence acceptable | None | Prepare checkout station only | Proximity context only | None | None | Delay local reset only | Show active | 2s | 60s | Never alter cart/checkout truth |
| `help` | `help_requested` | Staff/user action | None | Show help requested if operator UI exists | May use `warning` with high priority | None | Optional staff chime later | Block reset while human help active | Alert staff | 0s | 30s | Manual staff flow |

## Welcome Behavior

### presence_detected

Expected behavior:

- Wake or activate Welcome kiosk.
- Do not create customer identity.
- Do not greet automatically in MVP.
- Do not play audio automatically.

### presence_cleared

Expected behavior:

- No immediate customer-facing response.
- Existing local inactivity system resets normally.

## Pod Behavior

### presence_detected

Expected behavior:

- Activate pod lighting.
- Provide proximity context.
- Do not begin Rest Test.

### pod_occupied

Expected behavior:

- Backend may produce `rest_test_start_eligible` after checks.
- Delay local reset.
- Do not start Rest Test automatically.

### pod_vacated

Expected behavior:

- Backend may produce pause/end eligibility.
- Timer/reminder logic remains software-driven.
- Do not destroy shopper/cart state.

## Ask Snoozer Behavior

`presence_detected` provides proximity context only.

No automatic repeated speech.

## Bedding Behavior

`presence_detected` provides proximity context only.

No product truth may be invented. Shopify remains the source of truth for product data, variants, pricing, availability, media, and cart behavior.

## Checkout Behavior

`presence_detected` provides proximity context only.

Sensor work must never alter:

- cart
- checkout
- pricing
- availability
- variant IDs
- Shopify handoff

## Entry Behavior

`presence_detected` is backend/operator awareness only.

No MVP customer-facing greeting, lighting, audio, or automated response.

## Trigger Suppression

Snoozer must not repeatedly speak due to sensor flapping.

Recommended suppression:

- Presence prompt cooldown: 60 seconds per zone.
- Occupancy eligibility prompt cooldown: 60 seconds per pod/session.
- Fault prompt cooldown: 5 minutes unless severity changes.
- Manual override prompt: no cooldown if staff explicitly triggers.

Suppression key:

```text
{storeId}:{zoneId}:{eventType}:{sessionId-or-anonymous}
```

## Sensor Failure Behavior

If a sensor fails:

- Emit operator warning.
- Mark zone state stale or faulted.
- Keep manual showroom journey available.
- Do not block Rest Test buttons.
- Do not block Ask Snoozer.
- Do not block cart or checkout.
