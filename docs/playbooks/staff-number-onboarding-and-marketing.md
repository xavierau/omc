# Staff Playbook — Number Onboarding & Marketing Quality

**Audience:** OhMyClient Sales, CS, and Operations staff
**Purpose:** Decide how to onboard a new tenant's WhatsApp number (new vs existing), get the number into a healthy "Green" quality state with Meta, and run marketing campaigns without burning the number.

This doc is the **first thing a tenant-facing staff member reads** when a deal is signed. For the day-by-day ramp-up after the number is live, see `cs-whatsapp-onboarding-journey.md`.

***

## 1. Two onboarding paths — pick before kickoff

Every tenant arrives in one of two states. The path you pick changes the timeline, the risks, and the conversations you need to have.

| <br />              | Path A — **New number**                                         | Path B — **Existing number**                                                        |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| What it is          | Fresh SIM, never used in WhatsApp Business                      | A number already in WhatsApp Business App, or previously on another BSP / Cloud API |
| Quality history     | None — Meta will start rating from scratch                      | Inherited — good or bad, you keep it                                                |
| Time to first send  | \~3-5 working days                                              | \~5-10 working days (verification + migration)                                      |
| Biggest risk        | Number gets banned during warm-up because of bad content / list | Inherits a yellow/red rating you can't see until live                               |
| Marketing readiness | Day 1                                                           | After 7-14 days of clean signal                                                     |
| Recommended for     | New brands, second number, dedicated marketing line             | Brands who already have a customer base on that number and don't want to lose it    |

**Rule:** If the tenant insists on Path B, ask if they have ever been warned, paused, or rate-limited by Meta or another BSP. If yes, treat the first 14 days as a recovery period, not a ramp-up.

***

## 2. Path A — New number onboarding

### 2.1 Pre-kickoff checklist (Sales hands over)

Before CS takes the deal, confirm:

* [ ] HK SIM acquired by tenant, never used for WhatsApp before

* [ ] Tenant has a verified Meta Business account (or is willing to complete verification)

* [ ] Tenant's display name draft approved by us (see §4.2)

* [ ] Opt-in source documented for any contact list they want to import

* [ ] Vertical is allowed (HK F\&B is fine; gambling / adult / crypto / get-rich-quick is not)

* [ ] First three campaign concepts drafted

If any item is missing, do **not** start onboarding.

### 2.2 Provisioning steps

1. Run `/onboard-number` for the tenant. This handles embedded signup, webhook registration, and capturing `phone_number_id` + `business_account_id`.
2. Configure tenant in admin dashboard: brand name, timezone, daily cap (start at 100/day).
3. Smoke test: a personal phone DMs the tenant number, message arrives in inbox, reply works.
4. Submit display name for Meta approval (24-48h review).
5. Submit first three message templates (24h review per template).

### 2.3 Display name approval — the most common blocker

Meta rejects display names that:

* Contain generic words only ("Restaurant", "Promo", "Sale")

* Don't match the legal/brand name on Meta Business Manager

* Use ALL CAPS or excessive punctuation

* Imply a category the business isn't (e.g. "Bank XYZ" for a restaurant)

**Good:** `Tai Hing 太興`, `Mak's Noodle Central`, `Yardbird HK`
**Bad:** `Best Restaurant HK`, `PROMO TAI HING`, `Tai Hing Official Bank`

If rejected twice, escalate to platform team — third strikes can stall the account./Users/xavierau/Code/swift/My Simple MD Editor/icon-source.png

### 2.4 First 7 days — establish quality baseline

A new number has no quality rating until it sends \~50-100 messages. Use this window to:

* Send only utility-shaped messages to the tenant's most engaged 50-100 customers (VIP segment).

* Hand-pick recipients with the tenant — people who will recognise the brand instantly.

* Personalise every message (first name minimum).

* Watch for the rating to appear in WhatsApp Manager — when it shows **Green** for 3 consecutive days, the number is "established."

Do not run any marketing campaign in this window. See `cs-whatsapp-onboarding-journey.md` Phase 2 for content examples.

***

## 3. Path B — Existing number onboarding

### 3.1 Decide the migration shape

There are three sub-paths. Confirm which one applies:

| Sub-path | Source                                          | What we do                                                                 |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| B1       | WhatsApp Business App (consumer app)            | **Coexistence** — App and Cloud API live on the same number simultaneously |
| B2       | Another BSP / Cloud API                         | **Migration** — number moves to our WABA, app side stays untouched         |
| B3       | WhatsApp Business Platform on tenant's own WABA | **WABA transfer or sharing** — platform team decision                      |

For B3, always escalate to platform team before promising anything.

### 3.2 Coexistence (B1) — most common in HK F\&B

Many HK restaurants run their reservations and customer chats from the WhatsApp Business App. They want to keep that workflow and add marketing/automation on top.

Meta supports App + Cloud API on the same number. Key facts:

* Inbound messages can be routed to either App or Cloud API (we configure this).

* Outbound from Cloud API uses the same number, so the tenant's existing customers see consistent identity.

* The tenant must complete Meta Business Verification on the same business that owns the App.

* Two-step verification PIN must be cleared before linking.

Walk the tenant through the verification + PIN reset on a screen-share. This is where most tenants get stuck.

### 3.3 Migration from another BSP (B2)

Ask the tenant for:

* Current BSP name and account ID

* Current display name

* Current message template list (we'll re-submit the ones we need)

* Quality rating in their current dashboard (screenshot)

* Reason for switching

If they're switching because of a quality issue at the previous BSP, the number itself may have a poor rating that travels with it. Plan a 14-day quiet period before any marketing.

Coordinate the cutover window — there is a brief outage during the move.

### 3.4 Inheriting quality — what to expect

For Path B, the first thing that happens after migration is the rating becomes visible to us. Three scenarios:

* **Green inherited:** Treat as a Path A "established" number — can probe at 100/day from Day 1.

* **Yellow inherited:** Treat the first 14 days as Phase 2 (probe). No promotional templates. Utility only.

* **Red or Flagged:** Stop. Do not send anything except essential utility (order updates, reservation confirmations) for at least 14 days. Escalate to platform team for a recovery plan.

***

## 4. Getting the number into "good status"

"Good status" means:

1. **Display name:** Approved
2. **Business verification:** Approved
3. **Quality rating:** Green for 7+ consecutive days
4. **Tier:** Auto-scaled at least once (250 → 1K) without manual intervention
5. **No template flagged or paused in the last 30 days**

Until all five are true, the tenant is in onboarding, not steady-state.

### 4.1 What Meta is watching

Meta evaluates the number on a **rolling 7-day window**, weighted toward recent days. The signals:

* **Blocks** by recipients

* **Reports** (the "Report" button in WhatsApp)

* **Block reasons** users select: `No longer needed`, `Didn't sign up`, `Spam`, `Offensive messages`, `No reason`

* **Engagement** — read rates, reply rates

* **Volume vs unique users** — sending the same content to thousands looks worse than personalised sends

A single bad campaign can drop the rating Green → Yellow → Red within 48 hours.

### 4.2 Levers we control to keep it Green

| Lever             | What to do                                                           | Why it matters                                       |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Opt-in proof      | Reject any contact list segment without source + date + consent text | "Didn't sign up" is the #1 block reason              |
| Personalisation   | First name minimum; segment by engagement tier                       | Generic blasts get reported faster                   |
| Frequency cap     | Max 1 marketing message / 48h per recipient                          | Saturated users block faster                         |
| Send window       | Midday tenant-local time, never after 9pm                            | Late-night sends are reported as spam                |
| Template category | Use Utility for transactional, Marketing for promo (don't game it)   | Mis-categorised templates get paused by Meta         |
| Volume ramp       | Follow `cs-whatsapp-onboarding-journey.md` phase gates               | Sudden volume jumps trigger Meta's anomaly detection |
| Opt-out honour    | "Reply STOP" link in every marketing template; honour within seconds | Sending after opt-out is the fastest way to a ban    |

### 4.3 Tier auto-scaling — what unlocks higher limits

Meta auto-scales the messaging tier when **all** of these are true:

* Quality rating: Medium or High (not Red)

* Used at least 50% of current tier in the last 7 days

* Sent to a minimum number of unique users in 7 days:

| From → To        | Unique users / 7 days           |
| ---------------- | ------------------------------- |
| 250 → 1K         | (auto-scale on quality + usage) |
| 1K → 10K         | 500                             |
| 10K → 100K       | 5,000                           |
| 100K → Unlimited | 50,000                          |

**Implication:** scale comes from sending to *more unique users*, not sending more to the same users. Plan campaigns accordingly.

***

## 5. Marketing campaign awareness

Marketing is where most numbers get hurt. Every staff member who reviews or approves a campaign needs to internalise this section.

### 5.1 Template categories — get this right

Meta classifies every template as one of:

* **Utility** — transactional, expected, tied to a customer action (order confirmation, reservation reminder, loyalty balance, OTP-style updates)

* **Marketing** — anything promotional (offers, new dish, "we miss you", seasonal menus)

* **Authentication** — login codes only

**Never** submit a marketing message as Utility to dodge cost or volume rules. Meta auto-detects and re-categorises; the template gets paused, the number gets dinged.

When in doubt: if the message has a discount, an offer, an emoji-heavy CTA, or anything you'd describe as "promo," it's Marketing.

### 5.2 Opt-in is not optional

Before any marketing campaign, the recipient list must be filtered to contacts who:

1. Gave consent to receive marketing **on WhatsApp specifically** (not just "marketing in general")
2. Were shown the tenant's brand name at consent time
3. Have a recorded opt-in date in our system
4. Are flagged `opted_in_marketing = true`

Contacts without this — even longtime customers — must go through the re-confirmation flow described in `cs-whatsapp-onboarding-journey.md` §3.4 before they receive a single marketing message.

### 5.3 Block-reason mitigations — when you see them, act

Meta shows block reasons in WhatsApp Manager when rating is Yellow/Red. Map each reason to an action:

| Block reason         | What it means                               | What we do                                                |
| -------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `Didn't sign up`     | Opt-in is weak or fake                      | Audit the opt-in source; pause campaign; re-confirm list  |
| `Spam`               | Frequency or content too aggressive         | Cut volume by half; review last 5 templates               |
| `No longer needed`   | Content stopped being relevant              | Tighten segmentation; remove cold contacts from blasts    |
| `Offensive messages` | Tone, language, or imagery problem          | Pause ALL sends; review with tenant; escalate to platform |
| `No reason`          | Generic — usually means "I'm tired of this" | Treat like `No longer needed` + reduce frequency          |

### 5.4 The 24-hour customer service window

A free, unlimited reply window opens for 24 hours after a customer messages the tenant. Inside this window:

* No template needed — send free-form text/media

* No template fees from Meta

* Doesn't count against marketing limits in the same way

* Quality signals still matter, but spam-flagging is much lower

**Use it.** Encourage tenants to design campaigns that prompt inbound replies (questions, polls, "DM us to claim"), so the actual offer goes out inside the 24h window. This is the single biggest cost and quality lever.

### 5.5 Frequency, timing, and pacing rules

These are non-negotiable defaults — only platform team can lift them per tenant:

* **Per-recipient cap:** 1 marketing template / 48h

* **Per-tenant cap:** matches current Meta tier; stagger sends across the day, never blast all at once

* **Send hours:** 11:00 - 21:00 tenant-local time

* **Cooldown after Yellow:** 48h half-volume; resume only when Green for 24h

* **Cooldown after Red:** 14 days utility-only; full reset of campaign calendar

### 5.6 Campaign approval checklist

Every marketing campaign goes through a CS reviewer before sending. Reviewer confirms:

* [ ] Template category is correct (Marketing, not Utility)

* [ ] Opt-out language present ("Reply STOP")

* [ ] Personalisation variables used (first name minimum)

* [ ] Audience segment is opted-in for marketing

* [ ] Recipient count is within tenant's current tier and daily cap

* [ ] No identical content sent to >100 contacts (variants required)

* [ ] Send time is in the allowed window

* [ ] Last 7 days of quality is Green; if not, campaign is paused

If any item fails, the campaign goes back to the tenant with a one-line reason.

### 5.7 Red flags during a live campaign

While a campaign is sending, monitor in real time. Halt immediately if:

* Opt-out rate > 5% on any 1,000-message slice

* Block rate spike vs baseline

* `131049` errors (Meta's per-user marketing throttle) above background

* Any policy violation webhook fires

* Quality rating moves to Yellow

Halting mid-flight loses some sends but saves the number. Always the right call.

***

## 6. Migrating paper / legacy contact lists into the system

Most HK restaurant tenants arrive with contacts that live somewhere other than a clean digital marketing list. Common shapes:

* Reservation notebook (handwritten phone numbers + names)

* WhatsApp Business App chat list (no formal opt-in record)

* POS customer database (phone captured at order, no marketing consent)

* Lucky-draw / loyalty paper forms (sometimes with consent tickbox, sometimes not)

* Excel sheets the manager keeps personally

Treat all of these as **"unverified contacts"** until proven otherwise. Even contacts the restaurant has been chatting with for years on the Business App do not automatically have WhatsApp marketing consent under Meta's rules.

### 6.1 Step 1 — Digitise and grade the list (before any send)

Sit with the tenant for a list-grading session. For every batch of contacts, capture:

* **Source** — where these came from (which notebook, which POS export, which form)

* **Date range** — when were these phone numbers collected

* **Consent text shown** — what exactly was the customer told? ("We'll send offers on WhatsApp", "We may contact you", or nothing at all)

* **Channel of consent** — was it WhatsApp-specific, or generic marketing

* **Storage proof** — can the tenant produce the original paper / form / screenshot if asked

Then grade each batch:

| Grade      | Definition                                                                             | Treatment                                                        |
| ---------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Strong** | Consent text explicitly mentions WhatsApp marketing, dated <12 months, source provable | Eligible for re-confirmation send (§6.2 Strategy B)              |
| **Medium** | Generic marketing consent (any channel), dated <12 months                              | Must go through Strategy A or D, not B                           |
| **Weak**   | Phone collected for service (booking/order), no marketing consent                      | Strategy A or C only — never mass re-confirm                     |
| **None**   | No consent record, no source proof, or expired (>24 months)                            | Cannot be used for marketing; service-only inside the 24h window |

Reject any batch the tenant cannot grade with you. "We'll figure it out later" means it does not enter the system as marketable.

### 6.2 Step 2 — Pick an activation strategy per grade

**Strategy A — In-venue QR opt-in (best, works for any grade)**

* Print a small card / table-tent / receipt footer with a `wa.me/{number}?text=Join` link as a QR code

* Customer scans → WhatsApp opens → they tap send → an inbound arrives

* Inbound opens the 24-hour customer service window for that contact

* Inside that window, send a one-time confirmation template: "Welcome! Want offers and updates on WhatsApp? Reply YES."

* Match the phone number against the imported paper record; mark `opted_in_marketing = true` only after YES

* Zero marketing template is sent to a non-consented number — this is the safest path

**Strategy B — Re-confirmation utility template (Strong-grade only)**

* Submit a re-confirmation template, framed as utility, e.g.: *"Hi {first\_name}, this is {brand}. You signed up for our updates on {month}. We're now sending updates on WhatsApp — reply YES to keep receiving offers, or ignore this message and we won't message you again."*

* Send only to Strong-graded contacts

* Pace at 50-100/day, never blast

* Only run when the number has been Green for 7+ days (never on Day 1 of a fresh number)

* Mark `opted_in_marketing = true` only on YES reply

* Contacts who don't reply: keep in service-only state, do not message again

**Strategy C — Re-collect at next visit (Weak-grade)**

* Add a digital sign-up at the counter (tablet, QR, or receipt) with explicit "Yes, send me WhatsApp marketing" tickbox

* On next visit, the customer opts in properly

* System matches the phone and upgrades their record from Weak to Strong

* Slowest but cleanest — best for tenants with high repeat-visit rates

**Strategy D — SMS / email bridge (Medium-grade)**

* If the tenant already has SMS or email consent for these contacts, use that channel **once** to invite them to WhatsApp: *"Want offers on WhatsApp? Tap here: wa.me/{number}"*

* Customer taps → opens WhatsApp → sends inbound → opens 24h window → confirm via Strategy A

* Useful when the tenant has a clean email list but a messy paper book of phones

### 6.3 What NOT to do with paper lists

* Do **not** bulk-import all paper contacts and run a marketing campaign on Day 1

* Do **not** treat "they've been chatting with us on the Business App for 2 years" as opt-in

* Do **not** use a marketing template as the re-confirmation message

* Do **not** skip metadata capture and "fix it later" — once messages go out you cannot retroactively fix the consent record

* Do **not** run paper-list re-confirmation on a Path A new number; wait until quality is established

* Do **not** re-confirm contacts older than 24 months — the consent is too stale; use Strategy A or C instead

### 6.4 Suggested phasing for paper migration

A typical HK restaurant with a 2,000-name reservation book + Business App chat history should plan:

| Week           | Action                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup          | Grade the full list with the tenant. Most batches end up Weak or None.                                                                           |
| Week 1 (Probe) | New number warm-up only. Hand-picked VIPs the tenant knows personally. **No paper-list activity.**                                               |
| Week 2 (Build) | Roll out Strategy A in-venue (QR cards on tables, receipt footer). Start collecting fresh inbound opt-ins.                                       |
| Week 3         | If any Strong-graded batch exists, begin Strategy B at 50/day, paced.                                                                            |
| Week 4+        | Continue Strategy A in-venue indefinitely; this becomes the tenant's main growth channel. Strategy C runs on every customer visit going forward. |

Expect realistic numbers: a paper list of 2,000 typically converts to **300-600 verified opt-ins** over 4-8 weeks via Strategies A + B + C combined. Tenants who expect 100% conversion need to be told upfront this is not how it works.

### 6.5 Compliance notes (HK PDPO + Meta)

* HK PDPO requires explicit opt-in for direct marketing on a specific channel; consent for one channel does not transfer to another

* Meta's WhatsApp Business policy independently requires opt-in evidence

* Keep an audit trail per contact: when consent was captured, source, exact wording shown, opt-out events

* Provide a persistent opt-out path ("Reply STOP") in every marketing template

* If a regulator or Meta asks, the tenant must be able to produce the opt-in record — that's why §6.1 grading is non-negotiable

### 6.6 Tenant conversation script

When the tenant says *"I have 5,000 customer phone numbers from my reservation book — let's send them all a promotion"*:

> "I hear you, and I understand it's frustrating to wait. Here's the thing: those numbers are gold *only if* we activate them properly. If we blast them, three things happen — the number gets banned in days, you lose the contacts permanently, and you can't switch BSPs to recover because the rating follows the number. The path that actually works is slower for the first month and then much faster forever after. We turn your reservation book into a growing opt-in list using a QR code at the venue, plus a careful re-confirmation send for the freshest segment. By Week 4 you have a clean, growing list and a number that won't get banned. By Month 3 you'll be sending more than you would have been able to with a blast."

If the tenant insists on blasting anyway, escalate to platform team. This is one of the disqualify scenarios from the Sales playbook.

***

## 7. What every staff member should be able to answer

Use this as a quick self-check before facing a tenant:

1. Is this a new number or an existing one? Which sub-path?
2. What's the current quality rating, and how long has it been there?
3. What tier is the tenant on, and when was it last auto-scaled?
4. Is the opt-in story for the next campaign clean?
5. What's the block reason mix for the last 7 days, if any?
6. Are any templates currently paused or flagged?
7. What's the next phase gate, and what KPI must hold to pass it?

If you can't answer any of these, check the dashboard before talking to the tenant.

***

## 8. Escalation triggers

| Situation                                       | Who to involve                              |
| ----------------------------------------------- | ------------------------------------------- |
| Existing number arrives Red or Flagged          | Platform team — same day                    |
| Display name rejected twice                     | Platform team                               |
| Tenant insists on skipping warm-up              | Platform team — they decide                 |
| Block reason mix shows `Offensive messages`     | Platform team + Sales — pause everything    |
| `131049` errors spike                           | Engineering + Customer                      |
| Coexistence verification stuck                  | Platform team                               |
| Tenant in non-allowed vertical wants to onboard | Sales lead + Platform team                  |
| Quality drops to Red                            | Platform team + Sales + Customer (same day) |

***

## 9. The three rules nobody breaks

1. **No marketing send to a list without provable, WhatsApp-specific opt-in.**
2. **No advancing a phase if quality is not Green.**
3. **No mis-categorising a marketing message as utility to save cost.**

Break any one of these and the number, the tenant, and the shared WABA all lose.
