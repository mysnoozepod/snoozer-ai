# Sensor Non-Negotiables

## Purpose

This document defines the rules that must protect the Sensor Operating Layer from becoming unstable, messy, or dangerous to the core MySnoozePod showroom system.

Sensors are useful only if they make the showroom better without introducing risk.

These rules apply to Ty, Care, Langston, Codi, and anyone else helping with sensor planning, testing, documentation, or implementation.

## 1. Production-grade equipment only

The showroom is not a science project.

Any equipment tested for the Sensor Operating Layer should be close to what we would actually deploy in the showroom. We are not building with temporary hobby wiring, exposed boards, weak mounts, or unstable power setups.

Acceptable equipment should support:

- Secure mounting
- Stable power
- Clean wiring
- Enclosures where needed
- Device identification
- Recovery after reboot
- Reliable operation during showroom hours
- Clear maintenance steps

The equipment should look and behave like it belongs in a real unattended showroom.

## 2. Controlled rollout

Sensors must be rolled out in phases.

The correct order is:

1. Zone awareness
2. Experience triggers
3. Business behavior data
4. Pressure mapping on approved pods only

We do not jump straight into full automation.

Each phase must prove reliability before the next layer is added.

## 3. No checkout, cart, Shopify pricing, product handle, or variant ID changes

Sensor work must not touch commerce logic.

Sensors cannot change:

- Product prices
- Product availability
- Shopify product handles
- Shopify variant IDs
- Cart behavior
- Checkout behavior
- Payment flow
- Discount logic
- Product source of truth

Shopify remains the real-time commerce source of truth.

The Sensor Operating Layer can observe showroom behavior. It cannot interfere with buying, pricing, checkout, or product data.

## 4. No polling-based UI

The live showroom experience must not depend on polling.

The correct path is event-driven:

Sensor or edge controller  
→ AWS IoT Core over MQTT/TLS  
→ IoT Rule  
→ Lambda  
→ DynamoDB  
→ WebSocket push  
→ React Showroom App / Snoozer HUD / Operator View

The UI should receive updates through WebSocket push, not by repeatedly asking the backend if something changed.

Polling creates lag, unnecessary traffic, and reliability problems.

## 5. Sensor failure cannot break the shopper journey

If a sensor goes offline, the shopper experience must continue.

A shopper should still be able to:

- Start the showroom experience
- Complete the Snooze Assessment
- View their results
- Test pods
- Build a pod
- Add items to cart
- Request help
- Continue without being blocked

Sensor failure may reduce automation, but it must not stop the experience.

The system should degrade gracefully.

## 6. Pressure mapping only applies to the two non-adjustable-base pods

Pressure mapping is not part of every pod.

Pressure sensor maps are only approved for the two pods that do not use adjustable bases.

The reason is simple: adjustable bases create mechanical movement and fit issues that can make pressure pad use unreliable, uncomfortable, or impractical.

Pressure mapping should be treated as a controlled education and comparison tool, not a universal feature.

## 7. No medical claims

The Sensor Operating Layer must not make medical claims.

It cannot diagnose pain, sleep disorders, spinal conditions, circulation issues, sleep apnea, or any medical condition.

Approved language should stay educational.

Allowed direction:

- “This may help show how pressure is distributed.”
- “This can help compare how your body interacts with different comfort builds.”
- “This gives Snoozer another way to explain feel and support.”

Not allowed:

- “This mattress will fix back pain.”
- “This pressure map shows a medical issue.”
- “This product treats your condition.”
- “This proves your spine is aligned.”

MySnoozePod can support sleep health education. It cannot act like a medical device.

## 8. Event contract first

Before Codi builds sensor code, the team must define the event contract.

That means we must agree on:

- Zone names
- Device names
- Event types
- Required fields
- Optional fields
- Timestamp format
- Environment names
- Topic naming
- Error handling
- Acceptance criteria

Codi should not be asked to figure out the sensor strategy.

Codi implements after the contract is approved.

## 9. Codi implements only after Ty approves the Codi Handoff Packet

Care’s documentation and Langston’s field testing should produce a Codi Handoff Packet.

That packet should include:

- Mission
- Non-negotiables
- Zone dictionary
- Event dictionary
- Device matrix
- Business metrics
- Trigger map
- One-zone proof test
- Acceptance criteria
- Final prompt for Codi

Ty must approve that packet before Codi builds.

## 10. Sensors enhance Snoozer; they do not replace Snoozer

Snoozer remains the guide.

Sensors are not the personality, the sales logic, the product expert, or the customer-facing intelligence.

Sensors provide signals.

Snoozer uses approved logic to decide what to say, show, or ignore.

## 11. Privacy must stay clean

Before check-in, sensor behavior should be treated as anonymous showroom behavior.

After check-in, behavior can be connected to a Snooze Code or session only when the system has a safe and approved reason to do so.

The v1 system should not use cameras or movement patterns to identify a person.

## 12. Dev and production must stay isolated

Development events and production events must not mix.

Sensor topics, devices, and data flows should clearly separate:

- dev
- staging, if used
- prod

A test device should not accidentally send live production events.

## 13. Every device needs a clear owner and purpose

No sensor should be installed just because it is interesting.

Each device must have:

- Device ID
- Zone ID
- Physical location
- Purpose
- Event types
- Power method
- Network method
- Owner
- Testing status
- Failure notes

If the team cannot explain why a sensor exists, it should not be installed.

## Final Rule

The Sensor Operating Layer must make the showroom smarter, not more fragile.
