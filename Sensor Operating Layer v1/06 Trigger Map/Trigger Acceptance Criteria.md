# Trigger Acceptance Criteria

## Purpose

This document defines how a trigger earns approval before Codi implements it.

A trigger should not be built just because the sensor can detect something. It must improve the shopper journey or the operating system.

## Approval Questions

Every trigger must answer:

1. What event causes the trigger?
2. What should Snoozer or the system do?
3. Is the response customer-facing or operator-only?
4. What problem does this solve?
5. What is the risk if it fires too early?
6. What is the risk if it fires too often?
7. What happens if the sensor fails?
8. Can the shopper continue without it?
9. Does it touch checkout, cart, Shopify, pricing, handles, or variant IDs?
10. Has Ty approved it?

## Required Trigger Fields

| Field | Description |
|---|---|
| Trigger ID | Stable trigger name |
| Source Event | Event that starts the trigger |
| Zone | Zone where it applies |
| Response | What the system does |
| Priority | low, normal, high |
| Customer-Facing | yes or no |
| Stability Window | Time required before action |
| Cooldown | Time before same trigger can fire again |
| Fallback | What happens if sensor fails |
| Approval Status | proposed, approved, rejected, deferred |

## Starter Trigger Approval Table

| Trigger ID | Source Event | Zone | Response | Priority | Status |
|---|---|---|---|---|---|
| pod-rest-test-start | occupied | pod-* | Start/resume Rest Test timing | normal | proposed |
| pod-rating-prompt | vacated | pod-* | Ask for pod rating | normal | proposed |
| long-pod-dwell-check | occupied | pod-* | Ask if shopper wants to rate | normal | proposed |
| help-request-alert | help_requested | help-zone | Alert support and acknowledge | high | proposed |
| device-fault-alert | fault | any | Operator alert | high | proposed |
| accessory-guidance | touched | pillow-zone/bedding-zone | Offer accessory guidance | low | deferred |

## Stability Window Guidance

Starter guidance:

- pod occupied: 5 to 10 seconds stable
- pod vacated: 3 to 5 seconds stable
- help requested: immediate
- heartbeat: no shopper-facing trigger
- fault: operator-only

## Cooldown Guidance

A trigger should not repeatedly fire and annoy the shopper.

Starter guidance:

- Same pod prompt: no repeat for 3 to 5 minutes
- Accessory prompt: no repeat in same session unless user asks
- Help request: allow repeated use, but avoid duplicate alerts within a few seconds

## Rejection Criteria

Reject or defer a trigger if:

- It annoys the shopper
- It fires without clear value
- It depends on unreliable sensor behavior
- It tries to modify checkout or cart
- It makes medical claims
- It creates confusion during Rest Test
- It cannot fail gracefully

## Final Rule

Triggers must be earned. A sensor event is not automatically a customer-facing moment.