# Business Metrics Dictionary

## Purpose

This document defines the business metrics that may eventually come from the Sensor Operating Layer.

The goal is not to collect random data. The goal is to understand shopper behavior in a way that improves showroom operations, product presentation, staffing decisions, and Snoozer guidance.

## Metric Rules

Each metric must answer a real business question.

A metric should not be tracked unless it can help with:

- Customer experience
- Product testing flow
- Showroom layout
- Accessory engagement
- Human support timing
- Store performance
- Snoozer improvement
- Operational reliability

## Phase 1 Metrics

| Metric | Meaning | Data Source | Use |
|---|---|---|---|
| entry_count | Number of showroom entries | entry events | Traffic awareness |
| check_in_reached | Shopper reached welcome kiosk | welcome-kiosk events | Funnel awareness |
| first_pod_reached | First pod physically visited | pod entered/occupied events | Journey flow |
| pod_dwell_time | Time spent at a pod | occupied/vacated events | Product engagement |
| pod_skip_rate | Recommended pod skipped | session + pod events | Fit flow analysis |
| pod_revisit_rate | Shopper returned to a pod | pod events | Preference signal |
| accessory_engagement | Accessory area interaction | pillow/bedding events | Add-on interest |
| help_request_rate | Help requests by zone | help_requested events | Support planning |
| checkout_linger_time | Time near checkout/support | checkout-zone events | Buying friction signal |
| sensor_fault_rate | Device faults over time | fault events | Reliability tracking |

## entry_count

### Question answered

How many showroom entries happened?

### Notes

This should be anonymous unless connected to an approved session later.

## check_in_reached

### Question answered

Did visitors actually reach the welcome kiosk?

### Notes

Useful for identifying whether showroom entry flow is clear.

## first_pod_reached

### Question answered

Which pod does the shopper physically reach first?

### Notes

Can be compared against Snoozer’s recommended first pod.

## pod_dwell_time

### Question answered

How long does the shopper spend testing each pod?

### Notes

Longer dwell may indicate interest, comfort, confusion, or hesitation. It should not be treated as proof of purchase intent by itself.

## pod_skip_rate

### Question answered

Did the shopper skip the recommended pod?

### Notes

Useful for improving results presentation and physical showroom flow.

## pod_revisit_rate

### Question answered

Did the shopper come back to a pod after testing another one?

### Notes

Revisits may indicate comparison behavior or a favorite.

## accessory_engagement

### Question answered

Are shoppers interacting with pillows or bedding?

### Notes

Useful for merchandising and attachment opportunities.

## help_request_rate

### Question answered

Where do shoppers most often need help?

### Notes

Useful for improving Snoozer scripts, layout, signage, and human support timing.

## checkout_linger_time

### Question answered

Are shoppers hesitating near the checkout/support zone?

### Notes

Could indicate buying friction, confusion, or need for human support.

## sensor_fault_rate

### Question answered

How reliable is the sensor system?

### Notes

This is an operating metric, not a shopper metric.

## Final Rule

Every metric must connect to a decision. If no decision can be made from a metric, do not prioritize it.