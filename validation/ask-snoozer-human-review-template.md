# Ask Snoozer sampled-conversation human review

This is an internal human-review form. Automated quality scores do not fill it in and do not count as human validation.

## Sampling and privacy

- Use an explicitly sampled conversation from an internal showroom session.
- Remove names, email addresses, phone numbers, Snooze Codes, and unrelated profile details.
- Identify the sample with its anonymous quality-trace correlation ID and response-policy version.
- Review display and speech separately when audio is available.

## Review record

| Field | Entry |
|---|---|
| Anonymous correlation ID |  |
| Date/time window |  |
| Surface/device category |  |
| Response-policy version |  |
| Reviewer |  |
| Overall disposition | Pass / Needs review / Clear failure |
| Short reviewer note |  |

Score each dimension from 1 (poor) to 5 (excellent). Use N/A only when the dimension genuinely did not occur.

| Dimension | Score | Note |
|---|---:|---|
| Answered the actual question |  |  |
| Remembered relevant context |  |  |
| Asked only necessary questions |  |  |
| Sounded natural |  |  |
| Explanation was understandable |  |  |
| Preserved recommendation and product truth |  |  |
| Avoided pressure |  |  |
| Next action made sense |  |  |
| Length matched the task |  |  |
| Trustworthy enough to continue |  |  |

## Failure and recovery notes

| Prompt | Entry |
|---|---|
| What confused the shopper? |  |
| What did Snoozer misunderstand? |  |
| Did Snoozer recognize the problem? | Yes / No / N/A |
| Did it preserve valid context? | Yes / No / N/A |
| Did it discard invalid context? | Yes / No / N/A |
| Did it correct commercial truth? | Yes / No / N/A |
| Did it recover naturally and completely? | Yes / No / N/A |
| What should change? |  |

Store structured review entries as JSON with `disposition`, `note`, and a `scores` object when supplying them to `scripts/runAskSnoozerQualityReport.js --reviews <file>`.
