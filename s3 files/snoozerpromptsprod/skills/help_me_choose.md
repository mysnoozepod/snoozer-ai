---
title: Help Me Choose
category: skills
version: 1.3
updated: 2025-10-04
tags: ["recommendation", "assessment", "quiz", "comfort", "firmness", "cooling", "personalization"]
ui_actions:
  - { type: "open_tab", tab: "Explore" }
  - { type: "set_filters", value: { budget: "<1500", cooling: true } }
hints:
  - "Help me find the right mattress"
  - "I sleep hot, what’s best for me?"
  - "What’s good for side sleepers?"
  - "Show me mattresses under $1200"
---

## 🧭 Reply
Let’s find your perfect match.  
Tell me a little about how you sleep — things like preferred firmness, if you sleep hot, or your budget — and I’ll narrow it down instantly.

---

## 💡 Summary
Snoozer’s “Help Me Choose” feature combines your comfort preferences and budget to highlight products that fit your sleep style.  
It’s like a personal sleep consultant built into the experience — fast, transparent, and ready to guide you toward your ideal setup.

---

## 💬 Key Facts
- Works best when user provides **comfort**, **sleep position**, and **budget** info.  
- Filters products by tags: `firmness`, `cooling`, `height`, and `type`.  
- Automatically updates the Explore panel with matching mattresses.  
- Can combine assessment data (from prior quizzes) with current chat input.  
- Designed to be conversational — no forms, just friendly back-and-forth.  
- User can revisit results anytime in the **Explore** tab.  

---

## 📎 Recommended Actions
| User Intent | Snoozer Action |
|--------------|----------------|
| "Help me find a mattress" | open_tab: Explore + set_filters |
| "I sleep on my side" | set_filters: { sleepPosition: "side" } |
| "I like a firm mattress" | set_filters: { firmness: "firm" } |
| "I sleep hot" | set_filters: { cooling: true } |
| "Show me budget options" | set_filters: { budgetMax: 1200 } |

---

## 📚 Related Topics
- `skills/pricing.md`
- `skills/financing.md`
- `skills/returns.md`
- `faq/general.md`
- `products/mattresses/*.md`

---

## 🧠 Developer Notes
- Fast-path for intents: *choose, recommend, pick, suggest, find, hot sleeper, side sleeper, firm, soft*.  
- Backend behavior:
  - Extract `reply` for quick response.  
  - Parse sleep-related entities into structured `ui.actions → set_filters`.  
  - Return `ui.hints` for chips like “Show me cool mattresses under $1500.”  
- Always anchor “help_me_choose” before any product lookup.  
- Combine with S3 `products/mattresses/*.md` metadata for relevance.

---

## 🔍 Source
MySnoozePod — Personalized Mattress Matching Logic (2025).
