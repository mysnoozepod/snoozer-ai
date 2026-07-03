# Sensor Glossary

## Purpose

This glossary defines the basic terms used in the MySnoozePod Sensor Operating Layer.

The goal is for Ty, Care, Langston, and Codi to use the same language before planning hardware, writing code, or testing the showroom.

## Zone

A zone is a defined area of the showroom that the system cares about.

Examples include the entry area, welcome kiosk, Pod 1, Pod 2, pillow zone, bedding zone, and checkout/support zone.

A zone helps the system understand where activity is happening.

## Zone awareness

Zone awareness means the system can tell that something meaningful is happening in a specific showroom area.

For example, if a shopper lies down on Pod 3, the system should know that Pod 3 is occupied.

Zone awareness is the first sensor milestone.

## Trigger

A trigger is an approved system response caused by an event.

Example: if a shopper has been lying on a pod for enough time, Snoozer may offer to start or resume the Rest Test.

Triggers must be controlled. Not every event should cause Snoozer to speak or act.

## Event

An event is a structured message that says something happened.

Example:

A pod became occupied.  
A shopper left a zone.  
A help button was pressed.  
A device sent a heartbeat.  
A device reported a fault.

Events should include the zone, device, event type, timestamp, and other approved fields.

## MQTT

MQTT is a lightweight messaging protocol commonly used by IoT devices.

In simple terms, MQTT lets devices send small messages to a central system.

For MySnoozePod, MQTT would allow sensor devices to send zone events into AWS IoT Core.

## AWS IoT Core

AWS IoT Core is the AWS service that receives messages from connected devices.

For the Sensor Operating Layer, AWS IoT Core would receive sensor messages over secure MQTT.

It acts as the secure front door for sensor events before those events move deeper into the backend.

## Lambda

Lambda is AWS’s serverless compute service.

For the Sensor Operating Layer, Lambda would validate and normalize incoming sensor events.

That means Lambda checks whether the event is shaped correctly, cleans it up if needed, rejects bad events, and sends good events to the next system.

All Lambda work for this project should use Node.js 20.

## DynamoDB

DynamoDB is AWS’s NoSQL database service.

For the Sensor Operating Layer, DynamoDB would store sensor state and history.

Two important examples:

- ZoneState: the latest known state of each zone.
- ZoneEvents: the append-only history of sensor events.

## WebSocket

A WebSocket is a live connection between the backend and the frontend.

Instead of the React app repeatedly asking, “Did anything change?”, the backend can push updates instantly when a new event happens.

For MySnoozePod, WebSocket push is required for live showroom zone updates.

## Polling

Polling is when the frontend repeatedly asks the backend for updates on a timer.

Example: every five seconds, the app asks, “Did anything change?”

Polling is not approved for the live Sensor Operating Layer because it creates unnecessary traffic, delay, and reliability issues.

## False positive

A false positive happens when a sensor reports activity that did not really happen.

Example: a pod sensor says someone is lying on the mattress, but nobody is there.

False positives can cause Snoozer to speak at the wrong time or log bad showroom data.

## Missed event

A missed event happens when something real happens, but the sensor does not report it.

Example: a shopper lies on Pod 2, but the system never detects that Pod 2 is occupied.

Missed events make the showroom less aware and reduce trust in the sensor system.

## Debounce

Debounce is a technique used to prevent unstable or repeated signals from creating bad events.

Example: if a sensor rapidly flips between occupied and unoccupied, the system may wait a few seconds before accepting the event.

This helps prevent noisy sensor behavior from confusing Snoozer.

## Heartbeat

A heartbeat is a regular message from a device that says, “I am online.”

Heartbeats help the system know whether a device is still connected and healthy.

If a device stops sending heartbeats, the system may mark it as offline or faulty.

## Fault

A fault is an event that says something is wrong with a device or sensor.

Examples:

- Device offline
- Sensor disconnected
- Weak signal
- Bad reading
- Power issue
- Calibration issue

Faults should be visible to operators but should not break the shopper journey.

## Pressure map

A pressure map is a sensor-based view of how a shopper’s body pressure is distributed on a mattress.

For MySnoozePod v1, pressure mapping is only approved for the two non-adjustable-base pods.

Pressure mapping should be used for education and comparison only. It should not make medical claims.

## Anonymous behavior

Anonymous behavior is showroom activity that is not attached to a known customer profile or Snooze Code.

Example: someone enters the showroom or walks near a pod before checking in.

This type of behavior can help with general business metrics, but it should not identify the shopper.

## Checked-in behavior

Checked-in behavior is activity that happens after a shopper has started or connected to a known session.

Example: a shopper enters their Snooze Code, views their results, then tests Pod 4.

Checked-in behavior may help Snoozer guide the shopper more accurately, but it must still follow privacy and data rules.

## ZoneState

ZoneState is the latest known status of a zone.

Example:

Pod 3 is currently occupied.  
Pod 1 is currently vacant.  
The welcome kiosk zone is active.

ZoneState is useful for live showroom displays and operator awareness.

## ZoneEvents

ZoneEvents are the historical record of what happened in the showroom.

Example:

10:01 AM — entry zone entered  
10:03 AM — welcome kiosk active  
10:08 AM — Pod 4 occupied  
10:15 AM — Pod 4 vacated

ZoneEvents are useful for testing, reporting, and business intelligence.

## Device ID

A device ID is the unique name assigned to a physical sensor device or controller.

Example:

pod-1-edge-01  
entry-edge-01  
help-edge-01

Device IDs help the team know exactly which hardware sent an event.

## Zone ID

A zone ID is the system name for a showroom zone.

Example:

entry  
welcome-kiosk  
pod-1  
pod-2  
pillow-zone  
checkout-zone

Zone IDs must stay consistent because Codi, AWS, DynamoDB, and the React app will rely on them.

## Event type

An event type describes what happened.

Examples:

- entered
- exited
- occupied
- vacated
- touched
- help_requested
- heartbeat
- fault

Event types must be clearly defined before code is built.

## Confidence

Confidence is a number that describes how sure the system is about a sensor event.

Example:

A confidence of 0.94 means the system is highly confident the event is real.

Confidence may be useful when dealing with sensors that are not always perfect.

## Session ID

A session ID is the system’s identifier for a specific showroom visit or digital session.

It can help connect showroom behavior to a customer journey when appropriate.

Session ID should be optional for early anonymous zone events.

## Snooze Code

A Snooze Code is the customer-facing code used to connect a shopper to their MySnoozePod assessment or session.

Sensor events may include a Snooze Code only after the shopper has checked in or when the system has an approved reason to connect the event to that session.

## Edge controller

An edge controller is the device that sits near the sensors and helps send their data into the system.

It may receive physical sensor signals, clean them up, and send structured messages to AWS IoT Core.

For MySnoozePod, edge hardware should be production-grade and showroom-appropriate.

## Event contract

The event contract is the agreed structure for sensor messages.

It defines what every event must include, what fields are optional, and what values are allowed.

The event contract must be approved before Codi builds backend or frontend sensor features.

## Graceful degradation

Graceful degradation means the system keeps working even when one part fails.

Example: if sensors go offline, Snoozer can still guide the shopper through the normal screen-based experience.

This is required for the Sensor Operating Layer.

## Operator view

The operator view is the internal screen or dashboard that helps the MySnoozePod team understand system status.

It may show zone state, device health, recent events, and alerts.

This is not the same as the customer-facing showroom experience.

## Snoozer HUD

The Snoozer HUD is the customer-facing character and guidance layer.

Sensor events may eventually help the HUD respond at better times, but the HUD must still follow the approved response contract and showroom rules.

## Final Summary

The Sensor Operating Layer turns real showroom activity into clean events.

Those events help Snoozer and the MySnoozePod system become more aware, more responsive, and more measurable without risking checkout, product truth, privacy, or customer flow.
