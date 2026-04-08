---
title: Warranty Coverage
category: skills
version: 1.2
updated: 2025-10-04
tags: ["warranty", "coverage", "protection", "defects", "guarantee", "peace of mind"]
ui_actions:
  - { type: "open_tab", tab: "FAQs" }
  - { type: "show_faq", slug: "warranty" }
hints:
  - "How long is the warranty?"
  - "What does the warranty cover?"
  - "Do I need to register my mattress?"
  - "Who do I contact for warranty claims?"
---

## 🧭 Reply
Every mattress includes a limited warranty that protects you against defects in materials and craftsmanship.  
Coverage lasts up to 10 years, giving you peace of mind long after your purchase.

---

## 💡 Summary
Our warranty ensures lasting comfort and quality for the life of your mattress.  
If something goes wrong due to a manufacturing issue, we’ll repair or replace it under our coverage terms — no hidden hoops, just honest support.

---

## 💬 Key Facts
- Standard coverage: **10-year limited warranty** on mattresses.  
- Covers **manufacturer defects**, sagging, or workmanship issues.  
- Does not cover normal wear, stains, misuse, or personal comfort preference changes.  
- Adjustable bases typically include a **5-year electrical/mechanical warranty**.  
- Claims can be filed through our support portal or in-store.  
- Proof of purchase is required for all claims.  
- Warranties are non-transferable and apply to original purchasers only.

---

## 📎 Recommended Actions
| User Intent | Snoozer Action |
|--------------|----------------|
| "What does the warranty cover?" | show_faq: warranty |
| "How long is the warranty?" | reply: 10-year limited coverage |
| "How do I start a claim?" | open_tab: FAQs → show_faq: warranty |
| "Do I need to register?" | reply: No registration needed, your proof of purchase activates coverage |
| "Is the base included?" | reply: Bases have separate 5-year mechanical coverage |

---

## 📚 Related Topics
- `skills/returns.md`
- `skills/delivery.md`
- `faq/warranty.md`
- `policies/warranty.md`

---

## 🧠 Developer Notes
- Fast-path keywords: *warranty, guarantee, coverage, claim, defect, sagging*.  
- Backend extracts:
  - `reply` for short answers,
  - `ui.actions` for FAQ jumps,
  - `hints` for top chips.  
- Snoozer should clarify coverage type based on product category (e.g., mattress vs. base).  
- Combine with `products/*.md` metadata to return correct warranty per item.

---

## 🔍 Source
MySnoozePod — Limited Warranty Coverage Overview (2025).
