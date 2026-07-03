# Event Dictionary

## Purpose

This document defines the approved event types for the Sensor Operating Layer.

Events are structured messages that tell the system something happened in the showroom.

Event names must stay consistent. Codi, AWS IoT, Lambda, DynamoDB, WebSocket messages, the React showroom app, and Snoozer HUD logic may all rely on these names.

## Event Naming Rules

- Use lowercase.
- Use underscores if needed.
- Keep names simple.
- Do not create duplicate meanings.
- Do not rename events casually after approval.

## Approved Phase 1 Event Types

| Event Type | Meaning | Example Zone | Priority |
|---|---|---|---|
| entered | Something entered a zone | entry, pod area, accessory area | Normal |
| exited | Something left a zone | entry, pod area, accessory area | Normal |
| occupied | A pod or physical zone is actively in use | pod-1 through pod-5 | Normal |
| vacated | A pod or physical zone is no longer in use | pod-1 through pod-5 | Normal |
| active | A kiosk or zone is actively being used | welcome-kiosk, checkout-zone | Normal |
| idle | A kiosk or zone became inactive | welcome-kiosk, checkout-zone | Low |
| touched | An accessory or product area was interacted with | pillow-zone, bedding-zone | Low |
| help_requested | A shopper requested help | help-zone | High |
| heartbeat | A device reported that it is online | any device | Low |
| fault | A device reported a problem | any device | High for operator, low for shopper |

## Event: entered

### Meaning

The system detected entry into a zone.

### Example

A shopper walks into the entry zone or approaches a pod zone.

### Notes

Entered does not always mean the shopper is ready for Snoozer to speak.

## Event: exited

### Meaning

The system detected exit from a zone.

### Example

A shopper leaves the pillow zone.

### Notes

Exited should be used carefully when zones overlap.

## Event: occupied

### Meaning

The system detected stable use of a pod or physical zone.

### Example

A shopper lies down on Pod 3.

### Notes

Occupied should usually require a stable signal before being accepted.

## Event: vacated

### Meaning

The system detected that a previously occupied zone is no longer occupied.

### Example

A shopper gets up from Pod 3.

### Notes

Vacated events may help Snoozer ask for a rating or suggest the next pod, but only after approved trigger rules.

## Event: active

### Meaning

The system detected active use of a kiosk or interaction area.

### Example

The welcome kiosk is being used.

### Notes

This event may come from digital app activity, sensor activity, or a combined rule.

## Event: idle

### Meaning

The system detected that a kiosk or zone has become inactive.

### Example

The welcome kiosk has not been used for a defined time.

### Notes

Idle should not immediately mean abandonment.

## Event: touched

### Meaning

The system detected interaction with an accessory or product area.

### Example

A shopper handles pillows or bedding.

### Notes

Touched events are useful for business data and light guidance, not aggressive prompts.

## Event: help_requested

### Meaning

The shopper explicitly requested help.

### Example

The shopper presses a help button or selects a help action.

### Notes

This should be treated as high priority.

## Event: heartbeat

### Meaning

A device is online and reporting health.

### Example

pod-1-edge-01 sends a heartbeat.

### Notes

Heartbeat is for system health. It should not trigger shopper-facing Snoozer speech.

## Event: fault

### Meaning

A device has a problem.

### Example

A sensor disconnects, loses signal, or reports bad readings.

### Notes

Faults should alert operators but should not break the shopper journey.

## Open Questions

- Should occupied require 5 seconds of stable detection?
- Should vacated require 3 seconds of stable absence?
- Should accessory touched events trigger Snoozer or only business reporting in v1?
- Should help_requested always override other events?