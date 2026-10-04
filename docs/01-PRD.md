# 01 — Product Requirements Document

**Product:** DAIH Workspace Platform
**Organisation:** The Dare Adeboye Innovation Hub (DAIH), Redemption City, Ogun State, Nigeria
**Status:** Live at `daihworkspace.com`; payments and Google sign-in await production keys ([06 §3](06-Implementation-Plan.md#3-operational-readiness))
**Last updated:** 2026-10-04 (generated from the code at `master` e7d39aa)

> Companion documents: [02-TRD](02-TRD.md) · [03-App-Flow](03-App-Flow.md) · [04-UI-UX-Design-Brief](04-UI-UX-Design-Brief.md) · [05-Backend-Schema](05-Backend-Schema.md) · [06-Implementation-Plan](06-Implementation-Plan.md)
> Background and history: [DAIH_Technical_Design_Document.md](DAIH_Technical_Design_Document.md) · [DAIH_Milestone_Plan.md](DAIH_Milestone_Plan.md) · _PeeDee Build Specification_ and _PeeDee Loyalty — Business Overview_ (`.docx` in this folder). Feature status below is what the code does today: **Live**, **Partly working**, **Not built** or **Planned**.

---

## 1. Overview

The DAIH Workspace Platform runs the Hub's coworking business: people discover spaces, book and pay online, check in with a QR pass, and earn PeeDee Coins (PD) for coming back and bringing friends. It replaces reception logbooks, spreadsheet bookings and ad-hoc payment collection.

Five applications share one API and one database:

| Application     | Host                      | Audience                                      | Purpose                                                                   |
| --------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `web`           | `daihworkspace.com`       | Public                                        | Marketing site: spaces, plans, events, contact                            |
| `customer-pwa`  | `app.daihworkspace.com`   | Members                                       | Account, booking, payment, QR pass, PeeDee wallet, referrals, legal pages |
| `reception-app` | `kiosk.daihworkspace.com` | Reception and security                        | Scan passes, check members in and out                                     |
| `admin-portal`  | `admin.daihworkspace.com` | Operations, finance, management, super admins | Everything else                                                           |
| `api`           | `api.daihworkspace.com`   | —                                             | One modular API serving all four, plus a background worker                |

## 2. Goals

1. **Remove manual reception work** — booking, payment and check-in happen without staff transcription.
2. **Make capacity visible** — real-time availability and occupancy instead of a wall planner.
3. **Collect payment reliably** — Paystack checkout, with every charge confirmed server-side before a booking is confirmed.
4. **Give finance an auditable record** — every payment, discount, refund and coin adjustment traceable to a person and a reason.
5. **Control access by role** — seven roles, so reception cannot alter finance data.
6. **Grow retention and referrals** — reward repeat visits and referrals with PeeDee Coins and targeted campaigns.

**Non-goals for now:** native mobile apps (the PWA covers mobile), accounting-system integration, smart locks or biometrics, and multiple sites or tenants.

## 3. Target users

| User              | Role                | Primary needs                                                                                 |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| Visitor           | —                   | See spaces and prices without an account                                                      |
| Member            | `CUSTOMER`          | Book and pay, check in fast, track bookings and invoices, earn and spend coins, refer friends |
| Reception officer | `RECEPTION_OFFICER` | Verify passes, check people in and out, look up bookings                                      |
| Security officer  | `SECURITY_OFFICER`  | Verify passes at the gate                                                                     |
| Operations admin  | `OPERATIONS_ADMIN`  | Spaces, pricing, schedules, bookings, campaigns, reviews, policies                            |
| Finance officer   | `FINANCE_OFFICER`   | Payments, refunds, discounts, reconciliation, coin adjustments                                |
| Management viewer | `MANAGEMENT_VIEWER` | Read-only reports                                                                             |
| Super admin       | `SUPER_ADMIN`       | Everything, plus staff accounts and system settings                                           |

Staff accounts are created only by a super admin; every staff role must use MFA.

## 4. Features

### 4.1 Public website — Live

- Spaces, plans and featured reviews come from the API; news, events, jobs and gallery pages are static template content.
- "Book" buttons hand off to the member app; Privacy Policy and Terms link to the member app's pages.
- **Not built:** the contact form shows a success message but sends nothing; the newsletter box does nothing.

### 4.2 Member accounts — Live

- Email and password sign-up with an email verification link; Google sign-in (needs `GOOGLE_CLIENT_ID` in production); password reset.
- Onboarding question ("how did you hear about us?") and referral code; NDPR consent recorded with the policy version.
- Profile, birthday, avatar, password change, and self-service deactivation (not deletion). Members do not have MFA.

### 4.3 Discover and book — Live

- Browse spaces and plans; availability calendar; quantity for hot and flex desks; hourly, daily and monthly plans.
- A 10-minute hold with countdown; automatic discounts and promo codes.
- **Gaps:** unpaid holds do not appear on My Bookings, so they cannot be paid for or cancelled later; holds can be extended without limit ([03 §8](03-App-Flow.md#8-known-flow-gaps)).

### 4.4 Payments — Live in code, waiting for production keys

- Paystack hosted checkout; every charge is confirmed with Paystack, and its amount, currency and reference must match before a booking is confirmed.
- Invoices (`DAIH-INV-YYYY-NNNNNN`), downloadable receipts and monthly statements (PDF/CSV).
- Paid bookings cannot be cancelled by members; refunds are full-amount, raised by operations and approved by a different person in finance.

### 4.5 Access and check-in — Live

- Signed QR pass shown in the member app (generated on the device); reception scans with a camera or USB scanner, or searches by name, phone, email, reference or client ID.
- Same-day re-entry; live occupancy and shift telemetry on the kiosk.
- **Not built:** Wi-Fi credentials shown at check-in are generated by the app, not issued by the network (RADIUS is Phase 2).

### 4.6 PeeDee Coins — Partly working

- **Live:** single append-only ledger; 1 PD per ₦200 paid (0.5%), awarded when payment confirms; 20 PD signup bonus; 12-month expiry; manual adjustments with ceilings and audit; wallet and history in the member app; settings editable by operations and super admins.
- **Off by default:** spending coins at checkout (needs `ENABLE_COIN_REDEMPTION=true`).
- **Not firing:** check-in earnings, streak and birthday bonuses. See [03 §6.6](03-App-Flow.md#66-peedee-coins).

### 4.7 Referrals — Partly working

- **Live:** referral codes and share links, 30-day referral cookie, list of referred members.
- **Not firing:** the 200 PD welcome bonus for the referee and the referrer's 5% (90 days, 50 PD floor, 1,000 PD cap) — both depend on check-in.

### 4.8 Campaigns — Partly working

- **Live:** seven campaign types, audience rules, holdout groups, frequency caps, budgets, quiet hours, coin rewards, lift measurement; finance or super-admin approval above ₦50,000.
- **Gaps:** campaigns run only when someone presses Execute; delivery is email only; recipients receive each email twice while the worker runs.
- **Planned:** AI assistance. "Generate copy" fills in fixed templates; segmentation is rule-based RFM scoring.

### 4.9 Discounts — Live

- Percentage, fixed-amount and fixed-price discounts; promo codes or automatic; targeting by space, category, customer, first booking or email domain; validity windows.
- **Gaps:** no edit screen; total-usage caps are not enforced.

### 4.10 Reviews — Live

- Members review a visit after checking in (1–5 stars, comment); staff moderate, reply and feature reviews on the homepage.

### 4.11 Notifications and email — Live

- In-app notifications for members; transactional emails through Resend with ZeptoMail as fallback; staff are notified by email.

### 4.12 Support and legal — Partly working

- **Live:** contact channels and FAQs managed in the admin portal; Terms and Privacy Policy edited in a rich-text editor and shown publicly in the member app.
- **Not built:** support tickets — the member app's ticket form shows a reference number but sends nothing. Policy edits keep no version history.

### 4.13 Staff back office — Live, with gaps

- Dashboard, bookings, spaces and pricing, customers, visit logs, finance and reconciliation, refunds, discounts, loyalty, reports and exports, staff management, policy and FAQ editing.
- **Gaps:** the main Settings form does not save; walk-in "Issue Pass" is a mock; booking override always fails; audit logs are written but cannot be viewed. Full list: [03 §8](03-App-Flow.md#8-known-flow-gaps).

### 4.14 Planned (not built)

- AI-assisted campaigns: churn scoring, segment suggestions, copy generation.
- Phase 2 operations automation: subscriptions and passes, RADIUS Wi-Fi provisioning, SMS notifications, incident and no-show workflows.
- Phase 3: corporate accounts and team seats, visitor pre-registration, accounting integration.

## 5. User stories

| As a…             | I want to…                                                 | So that…                                      | Status                                            |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Visitor           | browse spaces and prices without an account                | I can decide before signing up                | Live                                              |
| Member            | book a space for a time and pay by card                    | my seat is guaranteed                         | Live (needs Paystack keys)                        |
| Member            | come back to an unpaid hold and pay later                  | I don't lose my reservation                   | Gap                                               |
| Member            | show a QR code at reception                                | check-in takes seconds                        | Live                                              |
| Member            | see my bookings, receipts and invoices                     | I can claim expenses                          | Live                                              |
| Member            | earn coins when I visit and spend them on bookings         | coming back costs less                        | Partly (earn on payment; spending off by default) |
| Member            | share my referral link and get rewarded when friends visit | inviting friends is worth it                  | Gap (rewards not paid)                            |
| Member            | review a visit                                             | others can trust the space                    | Live                                              |
| Member            | raise a support ticket                                     | someone follows up                            | Not built                                         |
| Reception officer | scan a pass and see instantly whether it is valid          | queues stay short                             | Live                                              |
| Reception officer | check a member out                                         | occupancy stays accurate                      | Live                                              |
| Operations admin  | add a space with pricing, opening hours and blackout dates | the catalogue is always right                 | Live                                              |
| Operations admin  | reserve a slot for a VIP                                   | I can accommodate exceptions                  | Gap (override fails)                              |
| Operations admin  | run a campaign to inactive members                         | they come back                                | Partly                                            |
| Finance officer   | reconcile Paystack against our records                     | discrepancies are caught                      | Live                                              |
| Finance officer   | approve refunds raised by operations                       | money leaves only with two people's agreement | Live                                              |
| Finance officer   | adjust a member's coins with a reason                      | goodwill and corrections are traceable        | Live                                              |
| Management viewer | export revenue and occupancy reports                       | I can review performance                      | Live                                              |
| Super admin       | invite staff with the right role                           | access matches the job                        | Live                                              |

## 6. Success metrics

No targets have been agreed. Baseline each metric over the first full quarter of live payments, then set targets.

| Metric                                                      | Why it matters                           | Source                                                           |
| ----------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Booking completion rate (hold → confirmed)                  | Friction between intent and payment      | `bookings.state`                                                 |
| Payment success rate                                        | Gateway or flow problems                 | `transactions.status`                                            |
| Reconciliation exceptions                                   | Should be near zero                      | `transactions` in `FLAGGED_MISMATCH` / `REQUIRES_RECONCILIATION` |
| Time from arrival to check-in                               | The core operational promise             | `visit_sessions.checkInTime` vs booking start                    |
| Occupancy by space and hour                                 | Pricing and investment decisions         | `visit_sessions`, `bookings`                                     |
| No-show rate                                                | Revenue leakage                          | `bookings.state = NO_SHOW`                                       |
| Repeat booking rate (30/60/90 days)                         | The retention baseline loyalty must beat | `bookings` by member                                             |
| Coin redemption rate and outstanding liability              | Programme health and cost                | `coin_ledger_entries`, `coin_balances`                           |
| Referral conversion (referred sign-up → first paid booking) | Acquisition from referrals               | `users.referredById`, `bookings`                                 |
| Campaign lift (treatment vs holdout)                        | Whether campaigns change behaviour       | `campaign_metrics`                                               |

## 7. Constraints and assumptions

- One site, one currency (NGN), Nigerian data-protection law (NDPA 2023 / NDPR).
- Paystack is the only payment gateway; email is the only outbound channel (no SMS or WhatsApp).
- The PWA is the mobile experience; native apps only if usage data proves the PWA insufficient.
- Wi-Fi provisioning depends on the Hub's network hardware (Phase 2).
- The organisation's name and contact details must be the same everywhere. Today the app and the published policies disagree ([04 §8](04-UI-UX-Design-Brief.md#8-content-and-tone)).
