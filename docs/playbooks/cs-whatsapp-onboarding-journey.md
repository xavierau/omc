# Customer Success Playbook — WhatsApp Onboarding & Warmup Journey

Audience: OhMyClient Customer Success team
Purpose: A step-by-step, day-by-day journey to take a new tenant from contract signature to a fully scaled WhatsApp marketing operation — without putting their number (or our shared WABA) at risk.

---

## 1. The journey at a glance

| Phase | Duration | Goal | Volume per day |
|---|---|---|---|
| 0. Discovery | Pre-contract | Disqualify or qualify; collect facts | — |
| 1. Setup | Days -7 to 0 | Number live, contacts cleaned, opt-in proven | 0 |
| 2. Probe | Days 1-3 | First sends, prove quality stays green | 50-100 |
| 3. Build | Days 4-7 | Expand audience, mix utility + light promo | 200-500 |
| 4. Scale | Weeks 2-3 | Personalised promos, segmentation | 1k-5k |
| 5. Full | Week 4+ | Full broadcasts within tier | up to tier |
| 6. Steady-state | Ongoing | Maintain green quality, monthly review | — |

You **do not advance to the next phase** unless quality is green and no incident is logged. This is the single most important rule in this playbook.

---

## 2. Phase 0 — Discovery (pre-contract)

Sales should hand you a completed discovery sheet (see Sales Playbook §3). Confirm before signing:

- Contact list size, and how the numbers were collected.
- Opt-in proof — what records do they have?
- Past WhatsApp marketing experience (especially: any prior bans?).
- Vertical (HK F&B is fine; gambling/adult/crypto/get-rich-quick is not).
- Their first three campaign concepts.

If anything is missing or worrying, escalate to the platform team before kickoff.

---

## 3. Phase 1 — Setup (Days -7 to 0)

### 3.1 Kickoff call (Day -7)

Walk the customer through this playbook. Set expectations clearly:

- "We're going to ramp from 50 messages on Day 1 to thousands per day in Week 4. This is faster than what feels comfortable to Meta if we push harder."
- "Your number will be permanently damaged if we skip the warmup. Our job is to protect that."
- "If quality drops, we will pause sends automatically. That is a feature, not a bug."

### 3.2 Number provisioning

Use the existing `/onboard-number` workflow. Confirm:

- HK SIM with Meta embedded signup completed.
- `phone_number_id`, `business_account_id` recorded.
- Webhook registered (the `onboard-tenant` script handles this).
- Smoke test: a personal phone can DM the new number and the message appears in the inbox.

### 3.3 Contact list ingestion

Critical step. Do **not** just bulk-import the customer's CSV.

For each batch:
1. Ask the customer for the **opt-in source** of the contacts: web form? POS prompt? QR code at the table? Loyalty signup?
2. Ask for the **business name** the customer was shown when consenting.
3. Ask for the **date** of consent (or date range).
4. Ask whether consent was for marketing, utility, or both.
5. Run any contacts older than 12 months through a re-confirmation step (next section).
6. Reject any list segment without clear opt-in metadata. Tell the customer they need to re-collect consent for those contacts.

### 3.4 Re-confirmation flow (for older or weak-consent lists)

If the customer has phone numbers from POS / reservation / loyalty signup but no recorded WhatsApp marketing consent:

1. Send a one-time **utility-format** message: "Hi {name}, this is {Business}. We'd like to send you exclusive offers and updates on WhatsApp. Reply YES to opt in, or ignore this message and you won't hear from us again."
2. Only contacts who reply YES are flagged `opted_in` for marketing.
3. Contacts who don't reply: stay in the system but cannot receive marketing.
4. This re-confirmation send itself is a utility/onboarding message and should go out at low volume, paced over several days.

### 3.5 Audience segmentation prep

Before Day 1, segment the opted-in list into engagement tiers:

- **VIP** — visited / purchased in the last 30 days
- **Active** — last 31-90 days
- **Warm** — last 91-180 days
- **Cold** — older than 180 days

The probe phase only sends to **VIP**. Cold segments are not touched until Phase 4 at the earliest.

### 3.6 First three campaigns co-designed

Sit with the customer and design the first three campaigns *with them*:

- Campaign 1 (Day 1): Welcome / utility-shaped first contact. Personalised. To VIP segment only.
- Campaign 2 (Day 4): Soft promo with strong personalisation. To VIP + Active.
- Campaign 3 (Day 8): Their actual first promotional content, segmented.

Submit each one to the template review queue. Get them approved.

---

## 4. Phase 2 — Probe (Days 1-3)

### 4.1 Day 1

- Volume: 50-100 messages, VIP segment only.
- Content: utility-shaped, personalised. Examples:
  - "Hi {name}, welcome to our WhatsApp updates! As a thank-you for being a loyal {brand} customer since {month} {year}, here's a small token: {offer}. Reply STOP to opt out anytime."
- Time: send at midday tenant-local time (best engagement, lowest spam-flag risk).
- After send: monitor for 24h. Check delivery rate, read rate, response rate, opt-out rate.

### 4.2 Day 2-3

- Repeat with similar volume, slightly different segments within VIP.
- Do not send the same content twice to the same person.
- Watch the quality dashboard. Quality should remain Green or Unknown.

### 4.3 Phase 2 KPI gate

Advance to Phase 3 only if **all** of these are true:

- Quality rating: Green (or Unknown — not yet rated, also fine).
- Delivery rate: ≥95%.
- Block / report rate: <0.5%.
- Opt-out rate: <2%.
- No `131049` errors above background.
- No policy violation webhooks.

If any KPI fails: pause, investigate, fix the root cause (usually content or audience), then re-probe. Do not advance.

---

## 5. Phase 3 — Build (Days 4-7)

### 5.1 Expand audience and content

- Volume: 200-500/day.
- Audience: VIP + Active.
- Content mix: ~70% utility, ~30% light promo. Examples of each:
  - Utility: "Your loyalty balance is {points} — that's enough for a free drink on your next visit."
  - Light promo: "We're launching a new dish next week. As one of our most loyal customers, you get to try it 3 days early — book here: {link}"
- Continue strict personalisation. No identical content to >100 contacts.

### 5.2 Phase 3 KPI gate

Same KPIs as Phase 2, plus:
- Read rate: ≥40% (utility) / ≥25% (promo). If below, content is the problem.
- Response rate: meaningful conversations starting.

If KPIs hold for 4 consecutive days, advance.

---

## 6. Phase 4 — Scale (Weeks 2-3)

### 6.1 Personalised promo at volume

- Volume: 1,000-5,000/day.
- Audience: VIP + Active + Warm.
- Content: segmented promotional campaigns. Each segment gets tailored content.
- Send pacing: spread over the day, do not blast in one minute.

### 6.2 Watch for the inflection point

This is where most numbers get into trouble. Volume is up, content quality drops because the customer is excited, opt-outs creep up.

Run a weekly review:
- Quality rating still green?
- Opt-out rate < 3%?
- Block/report rate < 1%?
- Read rate trend stable or improving?

If any of these are sliding, **revert one phase** for a week and tighten content with the customer.

---

## 7. Phase 5 — Full operations (Week 4+)

- Volume: up to tenant's current tier limit.
- Audience: all opted-in segments, each with its own content track.
- Customer can largely self-serve campaigns through the dashboard.
- CS reviews monthly (see §9).

By Week 4, the customer should know:
- How to draft a campaign in the dashboard.
- How to read the quality / engagement KPIs.
- What an opt-out is and how to honour it.
- Why the auto-pause triggered (if it ever did).

---

## 8. Content templates by phase (reusable starters)

### Phase 2 (Probe) — utility-shaped welcome
> Hi {first_name}, this is {brand}. Thanks for being a customer since {first_visit_month}. We're excited to keep in touch on WhatsApp — expect updates about your favourite dishes, exclusive offers, and your loyalty rewards. Reply STOP anytime to opt out.

### Phase 3 (Build) — utility
> Hi {first_name}, your loyalty balance is now {points} points — {points_to_next_reward} more and you unlock a free {reward}. See you soon at {nearest_branch}!

### Phase 3 (Build) — light promo
> {first_name}, we know you love our {favourite_dish}. We're launching a new version on {date} — as one of our most loyal customers, your seat is reserved. Tap to book: {link}. Not interested? Reply STOP.

### Phase 4 (Scale) — segmented promo
> {first_name}, it's been {days_since_last_visit} days since your last visit to {branch}. Come back this week and your next {dish} is on us — show this message at the counter. Valid until {date}. Reply STOP to opt out.

### Phase 5 (Full) — broadcast (still personalised)
> {first_name}, our {seasonal_menu} drops on {date} and as a {tier_name}, you get first pick. Reserve here: {link}. Reply STOP to opt out.

Always include opt-out language. Always personalise at minimum the first name.

---

## 9. Weekly review cadence (Phase 5+)

Each Monday morning:

1. Pull the tenant's quality / volume / engagement / opt-out report from the dashboard.
2. Note any auto-pause or yellow-quality events from the previous week.
3. Look at the planned campaigns for the coming week — anything risky?
4. Send the customer a 4-line update:
   - Quality rating and tier
   - Volume sent + delivered + read
   - Opt-out rate
   - One thing to do better next week

Monthly: bigger review. Discuss expanding audiences, new template ideas, ROI vs other channels.

---

## 10. Crisis protocols

### 10.1 Quality drops to Yellow

1. CS gets an automatic alert. Inform the customer within 1 hour.
2. Pause the next scheduled campaign.
3. Identify the trigger campaign. Look at: opt-out rate, block rate, read rate, content.
4. Brief the customer on what changed. Adjust content together.
5. Halve volume for 48 hours. Send only utility-shaped, well-segmented messages.
6. After 48h with stable Green-or-Unknown rating, slowly rebuild.

### 10.2 Quality drops to Red

1. Auto-pause kicks in (engineering safeguard). Customer cannot send.
2. CS calls the customer same-day. Explain what happened, no jargon.
3. Coordinate with platform team — Red quality also affects everyone else on the WABA.
4. Diagnose: was it content, list, frequency, or all three?
5. Recovery plan: 2-4 weeks of utility-only messages to top-engaged segment to rebuild the score.
6. Document the incident in the customer's account notes for future CS reference.

### 10.3 Spike in `131049` errors

This means Meta's per-user marketing limit is being hit. Causes:
- Customer is sending to users who already get many marketing messages from other businesses (saturated inboxes).
- Sending too frequently to the same users.

Action: increase per-user cooldown to 1 message / 48h. Reduce frequency. Move more sends inside the 24h customer service window (i.e. respond to inbound messages with the promo, instead of cold-broadcasting).

### 10.4 Mass opt-outs

If opt-out rate spikes >5% on any campaign:

1. Immediately stop the campaign mid-flight if still running.
2. Review the content with the customer. Was it misleading? Off-brand? Sent at a bad time?
3. Apologise and re-engage carefully. Do not send another marketing message to that segment for at least 7 days.

### 10.5 Customer demands to skip ahead

This will happen. Common scripts:

> "I understand it feels slow. Day 1 looks like a small number, but it's the difference between having a number that lasts you years vs one that gets banned in two weeks. I've seen the numbers — every customer who pushed harder ended up rebuilding from a banned number. We're doing this so you don't have to."

> "If we send too much too fast, Meta will lower your tier. That means *fewer* messages can be sent for the next 7 days, not more. The fastest way to scale is to follow the ramp."

If the customer keeps insisting, escalate to the platform team. Sometimes the right answer is to part ways — see the disqualify criteria in the Sales playbook.

---

## 11. Tools you'll use daily

- **Admin dashboard** — quality rating per tenant, sends in last 24h, opt-out rate, error rate.
- **Template review queue** — approve or request changes on campaigns.
- **Inbox** — see inbound replies, including opt-outs.
- **Tenant settings** — adjust daily cap, advance phase, manual pause/unpause.

If the dashboard is missing data or showing strange numbers, escalate to engineering — don't guess.

---

## 12. Escalation matrix

| Situation | Who to involve |
|---|---|
| Customer asks to skip warmup | Platform team |
| Quality drops to Yellow | Inform customer, monitor, no escalation |
| Quality drops to Red | Platform team + Sales + Customer (same day) |
| `131049` spikes | Engineering + Customer |
| Customer's vertical concern (gambling, adult, etc.) | Sales + Platform team |
| Auto-pause won't lift | Engineering |
| Customer asks for a separate WABA | Platform team (strategic decision) |
| Multiple tenants on the same WABA going Yellow at once | Platform team — emergency |

---

## 13. CS quick reference card

> **The four KPIs that matter:** quality rating, delivery rate, opt-out rate, block rate.
>
> **The four phases that protect the number:** Probe (Days 1-3), Build (Days 4-7), Scale (Weeks 2-3), Full (Week 4+).
>
> **The three things you never compromise on:** opt-in proof, ramp pacing, opt-out honoring.
>
> **The one rule that overrides everything:** if quality is not Green, do not advance the phase.
