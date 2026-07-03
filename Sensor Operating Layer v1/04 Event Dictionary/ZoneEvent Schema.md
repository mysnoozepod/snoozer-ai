# ZoneEvent Schema

## Purpose

This document defines the starter event contract for Sensor Operating Layer v1.

The event contract must be approved before Codi builds sensor backend or frontend features.

## Starter ZoneEvent JSON

```json
{
  "eventId": "evt_20260703_abc123",
  "env": "dev",
  "storeId": "severn-pilot",
  "deviceId": "pod-1-edge-01",
  "zoneId": "pod-1",
  "zoneType": "pod",
  "eventType": "occupied",
  "value": true,
  "confidence": 0.94,
  "sessionId": "sess_optional",
  "snoozeCode": "optional",
  "timestamp": "2026-07-03T13:10:00.000Z",
  "firmwareVersion": "1.0.0"
}