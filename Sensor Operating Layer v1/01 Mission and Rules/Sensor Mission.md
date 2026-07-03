# Sensor Mission

## Purpose

The purpose of the Sensor Operating Layer is to help MySnoozePod understand what is happening inside the showroom without guessing.

Sensors are not the main experience. Snoozer is still the guide. The showroom app is still the customer journey. Shopify is still the commerce source of truth. The sensors simply give Snoozer better awareness of where shoppers are, which pods they are interacting with, how long they are engaging, and when the system should respond.

The first version of this system is focused on zone awareness, not advanced automation.

## What problem are sensors solving for MySnoozePod?

MySnoozePod is designed to operate with limited human involvement. That means the system needs a reliable way to understand basic showroom activity.

Sensors help answer questions like:

- Did a shopper enter the showroom?
- Did the shopper reach the welcome kiosk?
- Which pod is the shopper currently testing?
- Did the shopper lie down on a mattress?
- Did the shopper leave the pod?
- Did the shopper spend meaningful time in one area?
- Did the shopper request help?
- Are there patterns in how shoppers move through the showroom?

Without sensors, Snoozer has to rely only on button clicks, screen activity, and customer input. That is not enough for a physical showroom.

Sensors help bridge the gap between the digital experience and the real showroom.

## Why does this matter in an unmanned showroom?

In a traditional mattress store, a salesperson watches the customer, reads body language, answers questions, and knows when to step in.

In MySnoozePod, Snoozer needs a safe and reliable version of that awareness.

Sensors allow the showroom to become more responsive without becoming intrusive. The system can know when a shopper is testing a pod, when they have moved on, when they may need guidance, and when the experience should stay quiet.

This matters because the showroom must feel guided, not abandoned.

## What should sensors help Snoozer understand?

Sensors should help Snoozer understand:

- Location: where the shopper is in the showroom.
- Activity: whether a zone is active, occupied, touched, or idle.
- Timing: how long the shopper spends in a zone.
- Flow: how the shopper moves from one area to another.
- Engagement: which pods, accessories, or areas receive the most attention.
- Readiness: when it makes sense for Snoozer to speak, prompt, or stay quiet.
- Issues: whether a device is offline, unreliable, or producing bad data.

Sensors should support better timing, better guidance, better reporting, and better showroom operation.

## What should sensors never be allowed to control or break?

Sensors should never be allowed to break the customer journey.

If a sensor fails, the shopper should still be able to complete the Snooze Assessment, view results, test pods, build a cart, request help, and complete the intended journey.

Sensors must never control or modify:

- Shopify pricing
- Product availability
- Product handles
- Variant IDs
- Cart logic
- Checkout logic
- Payment logic
- Customer identity
- Medical claims
- Final product recommendations without approved rules

Sensors can enhance the experience. They cannot become a single point of failure.

## Phase 1 Goal

The Phase 1 goal is zone awareness.

That means the system should be able to detect basic showroom activity by zone and send clean, structured events into the MySnoozePod system.

The first goal is not pressure mapping, advanced personalization, or full automation.

The first goal is to prove that the system can reliably detect zone activity and turn that activity into clean events.

## Phase 1 Zones

The starting zones are:

- Entry zone
- Welcome kiosk zone
- Pod 1
- Pod 2
- Pod 3
- Pod 4
- Pod 5
- Pillow zone
- Bedding zone
- Checkout/support zone
- Help zone

These zones may be refined after Langston completes physical showroom testing.

## Phase 1 Event Examples

The first version of the system should focus on simple events such as:

- entered
- exited
- occupied
- vacated
- touched
- help_requested
- heartbeat
- fault

Each event should be structured, timestamped, and tied to a zone and device.

## What success looks like

Phase 1 is successful when:

- Each showroom zone has a clear purpose.
- Each sensor has a clear job.
- Each event has a clear definition.
- Langston can physically test whether a zone event is reliable.
- Care can document what happened, what failed, and what needs to change.
- Ty can approve the event contract before Codi builds anything.
- Codi receives a clean handoff packet and does not have to guess the architecture.
- Sensor failure does not break the showroom experience.

## Plain-English Mission Statement

The Sensor Operating Layer helps Snoozer understand real showroom activity so the customer experience can become more responsive, more measurable, and more reliable without putting checkout, product data, or the shopper journey at risk.
