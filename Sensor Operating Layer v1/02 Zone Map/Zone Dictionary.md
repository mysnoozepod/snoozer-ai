# Zone Dictionary

## Purpose

This document defines the showroom zones that the Sensor Operating Layer will track in Phase 1.

A zone is a physical area of the showroom that may generate useful activity signals for Snoozer, business reporting, or operator awareness.

Phase 1 focuses on zone awareness only. The goal is to understand where activity is happening, not to over-automate the showroom.

## Zone Naming Rules

Zone IDs must be simple, consistent, lowercase, and stable.

Use hyphens instead of spaces.

Examples:

- entry
- welcome-kiosk
- pod-1
- pillow-zone
- checkout-zone

Once zone IDs are approved, they should not be casually renamed because Codi, AWS IoT, DynamoDB, WebSocket messages, and the React showroom app may rely on them.

## Phase 1 Zone List

| Zone ID | Display Name | Zone Type | Purpose | Phase 1 Priority |
|---|---|---|---|---|
| entry | Entry Zone | entry | Detect arrival into the showroom | High |
| welcome-kiosk | Welcome Kiosk | kiosk | Detect check-in and assessment activity | High |
| pod-1 | Pod 1 | pod | Detect pod testing activity | High |
| pod-2 | Pod 2 | pod | Detect pod testing activity | High |
| pod-3 | Pod 3 | pod | Detect pod testing activity | High |
| pod-4 | Pod 4 | pod | Detect pod testing activity | High |
| pod-5 | Pod 5 | pod | Detect pod testing activity | High |
| pillow-zone | Pillow Zone | accessory | Detect pillow/accessory interest | Medium |
| bedding-zone | Bedding Zone | accessory | Detect bedding/accessory interest | Medium |
| checkout-zone | Checkout / Support Zone | support | Detect cart, support, or decision activity | Medium |
| help-zone | Help Zone | support | Detect explicit support request | High |

## Zone: entry

### Purpose

The entry zone detects that someone has entered or moved into the showroom.

### Useful signals

- Shopper arrival
- Possible session start
- Traffic count
- Showroom activity outside scheduled sessions

### Approved event types

- entered
- exited
- heartbeat
- fault

### Notes

Entry events should not identify the shopper. They should be treated as anonymous behavior unless the shopper later checks in.

## Zone: welcome-kiosk

### Purpose

The welcome kiosk zone represents the first guided digital interaction.

### Useful signals

- Shopper reached kiosk
- Shopper may be ready to enter Snooze Code
- Shopper may begin assessment
- Shopper may need orientation

### Approved event types

- entered
- exited
- active
- idle
- heartbeat
- fault

### Notes

This zone should support the welcome flow, not interrupt it.

## Zones: pod-1 through pod-5

### Purpose

Pod zones represent mattress testing areas.

### Useful signals

- Shopper reached a pod
- Shopper lay down
- Shopper left the pod
- Dwell time
- Pod skip behavior
- Pod revisit behavior
- Rest Test timing

### Approved event types

- entered
- exited
- occupied
- vacated
- heartbeat
- fault

### Notes

Pod occupancy must be stable before triggering Snoozer. Avoid instant prompts from noisy or brief signals.

## Zone: pillow-zone

### Purpose

The pillow zone tracks accessory interest around pillows.

### Useful signals

- Shopper browsing pillows
- Opportunity for pillow-fit education
- Accessory engagement

### Approved event types

- entered
- exited
- touched
- heartbeat
- fault

### Notes

Pillow prompts should be contextual, not random. Do not interrupt core pod testing.

## Zone: bedding-zone

### Purpose

The bedding zone tracks accessory interest around bedding products.

### Useful signals

- Shopper browsing bedding
- Accessory engagement
- Possible add-on opportunity

### Approved event types

- entered
- exited
- touched
- heartbeat
- fault

### Notes

Bedding data is useful for business reporting, but the system should avoid aggressive upsell behavior.

## Zone: checkout-zone

### Purpose

The checkout/support zone tracks activity near the area where shoppers may review cart, request help, or prepare to purchase.

### Useful signals

- Shopper may be ready for assistance
- Shopper may be reviewing purchase decision
- Shopper may need human support

### Approved event types

- entered
- exited
- active
- idle
- heartbeat
- fault

### Notes

Sensor work must not control checkout. This zone can support guidance only.

## Zone: help-zone

### Purpose

The help zone represents an explicit help request area or device.

### Useful signals

- Shopper asks for assistance
- Support escalation needed
- Operator alert needed

### Approved event types

- help_requested
- heartbeat
- fault

### Notes

Help events should be treated as high priority and should not depend on other sensor states.

## Open Questions for Ty, Care, and Langston

- Will each pod have a dedicated sensor device?
- Will entry and welcome kiosk be separate physical zones?
- Will pillow-zone and bedding-zone require physical touch detection or only presence detection?
- Where should the help trigger physically live?
- Which zones matter most for opening day?
- Which zones can wait until Phase 2?