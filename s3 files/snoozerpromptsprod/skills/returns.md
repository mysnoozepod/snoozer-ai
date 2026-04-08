---
title: Returns & Exchanges
category: skills
version: 1.3
updated: 2025-10-04
tags: ["returns", "exchanges", "refunds", "trial", "warranty", "pickup", "non-refundable"]
ui_actions:
  - { type: "open_tab", tab: "FAQs" }
  - { type: "show_faq", slug: "returns" }
hints:
  - "What’s your return policy?"
  - "How long is the trial period?"
  - "Can I exchange my mattress?"
  - "Are motion bases or pillows returnable?"
---

## 🧭 Reply
Every mattress comes with a 100-night trial and free returns within that window.  
Motion bases, bedding, and pillows are final sale and cannot be returned or exchanged once opened.

---

## 💡 Summary
We want you to feel completely confident in your sleep setup.  
You can try your mattress for up to 100 nights, exchange it once if needed, or return it for a full refund.  
To protect product hygiene and electrical components, **motion bases, adjustable frames, pillows, and bedding are not refundable** once delivered or unboxed.

---

## 💬 Key Facts
- **100-night sleep trial** applies to mattresses only.  
- **Free returns and exchanges** within the trial period (one exchange per purchase).  
- **Non-returnable items:** motion bases, adjustable frames, pillows, and bedding.  
- Pickup scheduled by our delivery team—no repackaging required.  
- Refunds processed within **3–5 business days** after pickup.  
- Trial period begins the day your mattress is delivered.  
- Returns outside our core service area may include a small transport fee.

---

## 📎 Recommended Actions
| User Intent | Snoozer Action |
|--------------|----------------|
| "What’s your return policy?" | show_faq: returns |
| "How long is the trial?" | reply: 100 nights |
| "Can I exchange instead of return?" | show_faq: returns |
| "Are pillows or bases returnable?" | reply: no, they are final sale for hygiene and safety reasons |
| "How fast is the refund?" | reply: within 3–5 business days after pickup |

---

## 📚 Related Topics
- `skills/delivery.md`
- `faq/returns.md`
- `policies/returns.md`
- `skills/help_me_choose.md`

---

## 🧠 Developer Notes
- Fast-path for keywords: *return, refund, trial, exchange, pillow, base, bedding*.  
- Backend extracts:
  - `reply` (first block)
  - `ui.actions`
  - `hints`
- If user requests return for ineligible item, Snoozer should politely clarify and redirect to `skills/help_me_choose.md` for alternative solutions.

---

## 🔍 Source
MySnoozePod — 100-Night Sleep Trial & Return Policy (2025).
