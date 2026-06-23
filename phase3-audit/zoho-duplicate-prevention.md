# Zoho Duplicate Prevention Audit

## Scope
- Primary files inspected:
  - `C:\Users\14342\Desktop\snoozer-ai\services\zoho.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\customerProfileZohoSync.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\customerProfile.js`

## Lookup key
- Zoho lookup key is `Snoozer_Shopper_ID` by default in:
  - `services/zoho.js`
  - `services/customerProfileZohoSync.js`
- Override is supported with `ZOHO_CONTACT_KEY_FIELD`.

## Create conditions observed
- `syncCustomerProfileToZoho(...)` builds a canonical shopper payload in `services/customerProfileZohoSync.js`.
- `services/zoho.js` looks up by shopper id first.
- If no contact exists, it creates one.
- If exactly one contact exists, it updates it.
- If multiple contacts exist, it updates the first match and logs duplicate detection rather than creating a third contact.

## Update conditions observed
- Material profile changes are evaluated in `services/customerProfile.js` via `shouldSyncProfileToZoho(...)`.
- Lead-stage advancement can force a sync.
- Canonical recommendation field changes can force a sync.
- Low-value HUD/Ask fallback traffic is skipped when signals are weak.

## Duplicate handling behavior
- `services/zoho.js` logs `zoho.contact.lookup.multiple` when more than one contact matches.
- It logs `zoho.contact.duplicate_detected` and updates the selected existing contact.
- It does not create a third duplicate for the same shopper id.

## Validation result for code `1234`
- Repeated updates against the same shopper id reuse the same contact path.
- The duplicate-match harness confirmed that multiple matches do not create another Zoho contact.
- Low-value Ask/HUD interactions still skip noisy updates when they do not add meaningful profile signal.

## Remaining risks
- There is no automatic live cleanup path for already-duplicated Zoho contacts; this pass only prevents the code from creating more.
- Live duplicate validation still depends on safe test data and the current Zoho org state.

## Tests covering this area
- Existing:
  - `tests/runCustomerProfileZohoSyncTests.js`
  - `tests/runCustomerProfileInteractionEnrichmentTests.js`
- No additional Zoho-specific script was required in this pass because the existing coverage already exercises:
  - create once then update
  - duplicate-match update without third create
  - low-value intent skip
