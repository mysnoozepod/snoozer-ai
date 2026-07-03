# Trigger Map

## Purpose

This document defines possible system responses to sensor events.

A trigger is an approved response caused by an event. Not every event should create a trigger.

The Sensor Operating Layer must avoid annoying shoppers. Snoozer should respond only when the timing is useful.

## Trigger Rules

- Triggers must be approved before implementation.
- Sensor events should not automatically make Snoozer speak.
- Some events should only update operator view or business metrics.
- Help requests should receive high priority.
- Faults should notify operators, not shoppers, unless the customer flow is affected.
- Checkout/cart logic must not be controlled by sensors.

## Phase 1 Trigger Candidates

| Event | Possible Trigger | Priority | Customer-Facing? | Notes |
|---|---|---|---|---|
| entry.entered | Start welcome readiness | Normal | Maybe | Do not over-speak at entry |
| welcome-kiosk.entered | Offer check-in guidance | Normal | Yes | Useful if shopper pauses |
| pod.occupied | Start or resume Rest Test timing | Normal | Maybe | Only after stable occupancy |
| pod.vacated | Offer rating or next-pod guidance | Normal | Maybe | Avoid nagging |
| pod.occupied long duration | Ask if shopper wants to rate pod | Normal | Yes | Suggested after 7 minutes |
| pillow-zone.touched | Offer pillow-fit guidance | Low | Maybe | Only in relevant context |
| bedding-zone.touched | Offer bedding guidance | Low | Maybe | Do not interrupt core flow |
| checkout-zone.active | Offer cart or support guidance | Normal | Maybe | Only if cart/build context exists |
| help_requested | Alert support / respond immediately | High | Yes | Always important |
| device.fault | Operator alert | High | No | Do not break shopper flow |
| heartbeat | Update device health | Low | No | System health only |

## Trigger: pod occupied

### Condition

A pod reports stable occupied status.

### Possible response

Snoozer may start or resume the Rest Test for that pod.

### Guardrail

Do not trigger instantly. Use a stability window to avoid false positives.

## Trigger: pod vacated

### Condition

A pod reports stable vacated status after being occupied.

### Possible response

Snoozer may ask the shopper to rate the pod or move to the next pod.

### Guardrail

Do not nag if the shopper quickly returns or is still nearby.

## Trigger: help requested

### Condition

The shopper explicitly requests help.

### Possible response

Snoozer acknowledges the request and alerts the correct support path.

### Guardrail

This should be high priority and reliable.

## Trigger: accessory touched

### Condition

Pillow or bedding zone interaction is detected.

### Possible response

Snoozer may offer education or add-on guidance.

### Guardrail

Only use when the shopper is not actively in the middle of a pod-testing moment.

## Trigger: device fault

### Condition

A device reports a fault or stops sending heartbeat.

### Possible response

Operator view shows alert.

### Guardrail

Do not show scary technical errors to shoppers.

## Final Rule

A good trigger should feel like Snoozer noticed the right thing at the right time. A bad trigger feels like the showroom is interrupting the customer.