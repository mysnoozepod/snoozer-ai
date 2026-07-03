# Shopper Behavior Metrics

## Purpose

This document focuses specifically on shopper behavior patterns that sensors may help reveal.

The goal is to better understand how people move through the showroom, interact with pods, and respond to the guided experience.

## Behavior Categories

### Arrival Behavior

Questions:

- Did the shopper enter?
- Did the shopper move toward the welcome kiosk?
- Did the shopper hesitate near entry?
- Did the shopper leave before checking in?

Potential events:

- entry.entered
- entry.exited
- welcome-kiosk.entered

### Assessment / Check-In Behavior

Questions:

- Did the shopper reach the welcome kiosk?
- Did the shopper complete the assessment?
- Did the shopper abandon before results?
- Did the shopper need help at check-in?

Potential events:

- welcome-kiosk.entered
- welcome-kiosk.active
- welcome-kiosk.idle
- help_requested

### Pod Testing Behavior

Questions:

- Which pod did the shopper try first?
- Did the shopper follow Snoozer’s recommendation?
- How long did the shopper stay on each pod?
- Did the shopper skip any pods?
- Did the shopper revisit a pod?
- Did the shopper leave before completing the Rest Test?

Potential events:

- pod.entered
- pod.occupied
- pod.vacated
- pod.exited

### Accessory Behavior

Questions:

- Did the shopper engage with pillows?
- Did the shopper engage with bedding?
- Did accessory engagement happen before or after pod testing?
- Did accessory engagement lead to cart activity?

Potential events:

- pillow-zone.entered
- pillow-zone.touched
- bedding-zone.entered
- bedding-zone.touched

### Support Behavior

Questions:

- Did the shopper request help?
- Where did the help request happen?
- Did help requests cluster around checkout, assessment, or pods?
- Did Snoozer fail to answer something clearly?

Potential events:

- help_requested
- fault
- checkout-zone.active

### Checkout Behavior

Questions:

- Did the shopper reach the cart or checkout support area?
- Did the shopper linger?
- Did the shopper request help before buying?
- Did the shopper abandon after building a pod?

Potential events:

- checkout-zone.entered
- checkout-zone.active
- checkout-zone.idle
- help_requested

## Important Interpretation Rule

Sensor behavior is not the same thing as intent.

Example:

A shopper spending 10 minutes on a pod may mean:

- They liked it.
- They were confused.
- They were tired.
- They were waiting.
- They were comparing.
- They needed help.

Sensors provide signals. Snoozer and business rules provide interpretation.

## Privacy Rule

Before check-in, behavior should be treated as anonymous.

After check-in, behavior can be connected to session context only when approved and useful.

## Phase 1 Reporting Goal

The first reporting goal is simple:

Can the team understand showroom movement better than they could with screen clicks alone?

If yes, the Sensor Operating Layer is useful.