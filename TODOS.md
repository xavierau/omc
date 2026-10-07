# TODOS

## TODO: Seed Data Script for Demo Fallback
**What:** Create a script that populates the DB with realistic demo data.
**Why:** Dashboard-first build sequence requires seed data from Day 1. Also serves as demo fallback if WhatsApp flow fails during investor pitch.
**Details:** 1 restaurant, 50 members (varying join dates, some active, some inactive), 100 receipts with point awards, 10 redeemed coupons, recent events for live feed. Should be idempotent (re-runnable without duplicates).
**When:** Day 1-2 (alongside dashboard stub).
**Depends on:** Supabase schema must be created first.

## TODO: Test QR Deep Link on 5+ Devices
**What:** Test wa.me deep link with pre-filled text on multiple devices before demo day.
**Why:** wa.me deep links don't auto-send on some Android devices/WhatsApp versions. If the investor's phone doesn't auto-send, the demo stalls.
**Details:** Test on iPhone (latest), Android Samsung, Android Pixel, older Android, iPad. Document which auto-send vs require manual tap. If problematic, consider Kapso-hosted landing page alternative.
**When:** Day 12-13 (polish phase).
**Depends on:** Kapso number must be provisioned and QR code generated.

## TODO: Extract DESIGN.md from Plan
**What:** Create a standalone DESIGN.md file with the visual identity (colors, typography, spacing, component specs, anti-slop rules) currently inlined in the design doc.
**Why:** Plan-inlined specs work for the hackathon but don't scale. DESIGN.md becomes the single source of truth for UI decisions that any engineer can reference without reading the full plan.
**Details:** Extract the "Visual Identity" section from the design doc. Add component examples (button variants, card layouts, stat card specs). Include Tailwind config snippet with custom colors.
**When:** Post-demo (low priority).
**Depends on:** Demo complete. Visual identity finalized during implementation.

## TODO: Design Receipt Confidence State Machine
**What:** Spec the multi-turn conversation flow for low-confidence receipt parsing.
**Why:** When Claude Vision returns low confidence, the bot asks customer to confirm total. This is a multi-turn conversation needing state tracking (PENDING_CONFIRMATION → DONE).
**Details:** State transitions: photo received → PENDING_CONFIRMATION → YES (award points) / number (use corrected amount) / other (re-prompt) / new photo (cancel previous). Add `status` field to receipts table: 'processing', 'pending_confirmation', 'confirmed', 'rejected'. Track `pending_amount` for the AI's guess.
**When:** Before implementing receipt scanning (Day 5-6).
**Depends on:** Data model finalized.
