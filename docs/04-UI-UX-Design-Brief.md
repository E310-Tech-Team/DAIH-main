# 04 — UI/UX Design Brief

**Product:** DAIH Workspace Platform
**Last updated:** 2026-10-04 (generated from the code at `master` 1dc9e9a)

> Companion documents: [01-PRD](01-PRD.md) · [02-TRD](02-TRD.md) · [03-App-Flow](03-App-Flow.md) · [05-Backend-Schema](05-Backend-Schema.md) · [06-Implementation-Plan](06-Implementation-Plan.md)
> Each section records what the code does today. Items marked **Direction** are recommendations for consolidating the system — **not implemented and not yet agreed**; they are tracked in [06-Implementation-Plan](06-Implementation-Plan.md).

---

## 1. Design direction

DAIH presents as a calm, premium workspace brand: deep purple, generous white space, rounded cards and line icons. The same visual language appears on four surfaces with different jobs:

| Surface                       | Users                | Character                                                                          |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Marketing site (`web`)        | Public               | Image-led Bootstrap template; sells spaces and hands off to the member app to book |
| Member app (`customer-pwa`)   | Members              | Responsive web app installable as a PWA; booking, wallet, pass                     |
| Admin portal (`admin-portal`) | Staff                | Dense, table-heavy back office with role-filtered navigation                       |
| Reception (`reception-app`)   | Front desk, security | Scan-first single screen: camera, USB scanner or manual lookup                     |

**Current state in one line:** one look implemented four times. Each app keeps its own copy of the design tokens, and about 2,000 colour values are hardcoded as Tailwind `[#hex]` classes rather than tokens.

## 2. Colour

### 2.1 Palette in use

| Role                       | Value                                                    | Where                                                                     |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Primary (brand purple)** | `#23055c`                                                | Apps' primary buttons, active nav, headings, charts, PDFs (≈1,180 uses)   |
| Primary — logo/web variant | `#220563`                                                | Exact colour of the logo artwork; web `.btn-main` and `--secondary-color` |
| Primary hover / container  | `#392271` (apps), `#35089e` (web)                        | Hover and pressed states                                                  |
| Lavender tint              | `#ebe7f5`                                                | Selected rows, soft accents, scrollbar track (≈290 uses)                  |
| Secondary                  | `#65519f` / `#bfa9fe`                                    | Admin secondary and secondary container                                   |
| Surfaces                   | `#f7f9ff`, `#f8f9fa`, white                              | Page background, table headers, cards                                     |
| Ink                        | `#181c20` (admin `on-surface`), `#1a1d20`                | Body text in admin                                                        |
| Outline                    | `#7a7581`, `#cac4d2`, slate-200                          | Borders and dividers                                                      |
| PeeDee / coins             | Tailwind amber (≈`#d56c04`–`#d97706`)                    | Coin pill, wallet highlights, Gold tier                                   |
| Success                    | emerald (live dot `#10b981`)                             | Confirmed, checked in, paid                                               |
| Warning                    | amber                                                    | Holds, pending, expiring                                                  |
| Error                      | rose, red, admin `error` `#ba1a1a` / container `#ffdad6` | Failures, destructive actions                                             |
| Info                       | blue in `Badge`, purple in `Toast`                       | Inconsistent                                                              |
| Tier colours               | Bronze `#b45309`, Silver `#64748b`, Gold `#d97706`       | `MemberTierBadge`                                                         |

**Legacy colours still in the code** (not part of the brand):

- Navy `#1f3a68` and amber `#d56c04` are defined as `brand`/`accent` in `packages/config/tailwind.config.js` and the member app's config. Those tokens have 0 uses in the app, but `packages/ui` still hardcodes navy (the Button primary, the Input focus ring, the QRDisplay bar). Navy also remains in the PWA manifest (`theme_color #1f3a68`, `background_color #0f1d35`) and in the `global-error.tsx` pages.
- Royal blue `#0032d0` comes from the web template's `coloring.css`, about 86 rules (`.btn-primary`, `.bg-color`, `#topbar`, …).

**Direction:**

- Define one shared token set in `packages/config` and make every app use it.
- **Primary:** standardise on `#220563`, the logo colour. It is visually identical to `#23055c`, so this is a token change, not a redesign.
- Keep `#392271` for hover and `#ebe7f5` for tints.
- Reserve amber for PeeDee coins and tiers.
- Use one info colour (sky/blue) so informational messages are never confused with primary actions.
- Remove navy and the template blue, and set the manifest `theme_color` to the primary.

### 2.2 Contrast

| Pair                                              | Ratio  | WCAG AA (4.5:1 text)    |
| ------------------------------------------------- | ------ | ----------------------- |
| White on `#23055c`                                | 16.8:1 | Pass                    |
| slate-400 on white (≈500 uses for text and icons) | 2.56:1 | **Fail**                |
| White on amber `#d56c04` (amber Button)           | 3.51:1 | **Fail**                |
| White on emerald-600 (kiosk check-in button)      | 3.77:1 | **Fail** for small text |
| White on amber-600 (kiosk check-out button)       | 3.19:1 | **Fail**                |

**Direction:**

- Body and helper text: slate-500 or darker on white.
- Status buttons: the 700 shades, or dark text on the 100–200 shades.

## 3. Typography

| App            | Current                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member app     | Downloads **Inter** (300–800) in `app/layout.tsx` but never applies it — the Tailwind config does not set `fontFamily`, so text renders in the system font stack |
| Admin portal   | **Work Sans** 400–800 plus Material Symbols Outlined; defines a Material 3 type scale (`label-sm` 12/16 → `display-lg` 48/56) that only 9 components use         |
| Reception      | Work Sans (Inter as fallback)                                                                                                                                    |
| Marketing site | Work Sans 200–800 via `@import`; body 16/26 weight 300 `#404040`; headings 700 `#464c4b`; h1 54px                                                                |

**Conventions in the code:**

- Page titles: `text-2xl sm:text-3xl font-extrabold tracking-tight`.
- Section labels: `text-[10px]` or `text-xs`, bold, uppercase, `tracking-wider`, slate-400/500.
- References and IDs: `font-mono`.
- Body copy leans small and bold. `text-xs` is the most common size (922 uses in admin, 423 in the member app), custom 9–11px sizes appear about 730 times, and admin has 902 `font-bold`.

**Direction:**

- Use Work Sans everywhere, self-hosted through `next/font`, which also removes the render-blocking font `<link>`.
- Adopt the admin Material 3 scale as the shared scale.
- Minimum sizes: 14px (`text-sm`) for body text, 12px for labels.

## 4. Shape, depth and spacing

- **Radius (current):**
  - Shared pattern: `rounded-xl` for cards, buttons, inputs and nav items; `rounded-2xl` for panels and modals; `rounded-full` for pills and avatars.
  - Admin overrides Tailwind's radius scale: default 2px, `lg` 4px, `xl` 8px, `full` 12px.
  - As a result the same markup draws 12px corners in the member app but 8px in admin, and round avatars become rounded squares.
  - `rounded-DEFAULT` (21 uses) is not a valid class.
- **Elevation:**
  - `shadow-sm`, `shadow-md` and `shadow-2xl` do the work; admin adds `.elevation-1`.
- **Classes that do nothing** under Tailwind 3.4:
  - `shadow-xs` (346 uses), `shadow-2xs` (71) and `backdrop-blur-xs` (52) are Tailwind 4 names.
  - About 177 `animate-in` / `fade-in` / `zoom-in` classes need the `tailwindcss-animate` plugin, which isn't installed.
  - On the marketing site, Tailwind utility classes do nothing at all, because its CSS has no `@tailwind` directives.
- **Spacing and width:**
  - Cards use `p-4`/`p-6`, with `gap-2`/`gap-3` and `space-y-4`.
  - Max width is `max-w-7xl` in the member app and `max-w-[1600px]` in admin and reception.
  - The marketing site uses a 14px radius and pill buttons.

**Direction:**

- Remove admin's radius override.
- Either upgrade to Tailwind 4 or rename the v4-only classes and add `tailwindcss-animate`, so that what designers see in the code matches what renders.

## 5. Components

### 5.1 Shared library (`packages/ui`)

| Component               | API                                                                                        | Used by                              | Gaps                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `Button`                | `primary`, `secondary`, `outline`, `ghost`, `danger`, `amber`; `sm`/`md`/`lg`; `isLoading` | Admin (settings, reports, resources) | Primary is navy; admin overrides it with `bg-[#23055c]`, leaving a navy focus ring             |
| `Card`                  | `hoverEffect`                                                                              | Admin (once)                         | —                                                                                              |
| `Badge` / `StatusBadge` | 6 variants; booking-state mapping                                                          | **No app**                           | Unused                                                                                         |
| `Input`                 | `label`, `error`, `helperText`                                                             | Admin                                | Label linked via `htmlFor`; no `aria-invalid`/`aria-describedby`                               |
| `Modal`                 | `isOpen`, `onClose`, `title`                                                               | Admin (7 files)                      | Portal, Escape and scroll-lock work; no `role="dialog"`, `aria-modal` or focus trap            |
| `QRDisplay`             | `token`, `customerName`, `bookingRef`, `validUntil`                                        | Member app                           | Image comes from `api.qrserver.com`: fails offline and sends the access token to a third party |
| `Toast`                 | `ToastProvider`, `useToast` (success/error/warning/info, 4.5 s, 1.5 s de-dupe)             | Member app, admin                    | Reception mounts the provider but uses `alert()` instead                                       |
| `cn`                    | `clsx` + `tailwind-merge`                                                                  | Admin                                | —                                                                                              |

### 5.2 Patterns built inside the apps

- **Modals:** about 27 hand-built overlays in admin and 5 in the member app, with varying backdrops (slate/black at 40–80%) and z-indexes.
- **Tables:**
  - Hand-built: `#f8f9fa` header row, uppercase extra-small headings, `p-4` cells.
  - Scroll horizontally inside `overflow-x-auto min-w-[880px]`; numbered pagination (see `customers/MemberDirectoryTable.tsx`).
- **Charts:** inline SVG lines (revenue `#23055c`, occupancy amber) and div-based bars; no chart library.
- **Loading and empty states:** one-off `animate-pulse` blocks (11 member-app files, 23 admin files); empty states written inline.
- **Admin `StatCard`** for dashboard numbers.
- **Kiosk scanner:** `html5-qrcode` with an audio beep and haptic feedback on a successful scan.
- **Duplicated in admin and the member app:** `AvatarCropperModal`, `RichPolicyRenderer`, `image-utils`.

**Direction:**

- Promote `Table`, `Skeleton`, `EmptyState`, `Select`, `DatePicker` and an accessible `Dialog` into `packages/ui`.
- Fix `Button` to use the primary token.
- Render QR codes locally (for example with the `qrcode` package), which is both an offline fix and a security fix.

## 6. Layout conventions

- **Member app:**
  - From `md` up: a fixed left sidebar (`w-64`, collapsible to `w-20`) and a sticky, blurred top bar.
  - Top bar contents: logo, notifications, help, tier badge, amber PD-coin pill, avatar.
  - Below `md`: the sidebar becomes a slide-out drawer opened by a hamburger. **There is no bottom tab bar.**
  - Auth screens split 50/50 into an image panel and a form.
  - Receipts have a print stylesheet. No safe-area insets for notched phones.
- **Admin portal:**
  - Fixed 65px header: logo, breadcrumb, "Live" pill, link to the member app, role pill, sign-out.
  - From `lg` up: a sticky grouped sidebar (`w-72`, or `w-20` collapsed). The collapsed state is remembered and ⌘/Ctrl+B toggles it. Below `lg` it slides out.
  - Nav items are filtered by role.
- **Reception:**
  - One page with Camera / USB / Manual tabs and a clock.
  - Two columns from `lg` up.
  - Not locked down: no fullscreen, wake-lock or idle reset. A verified member's details and Wi-Fi PIN stay on screen until staff dismiss them.
- **Marketing site:**
  - Bootstrap 5 + MDB on the Designesia template (jQuery, WOW, Owl Carousel, Magnific Popup).
  - The header turns from transparent to solid on scroll; mobile menu below 992px.
- **Breakpoints:**
  - Tailwind defaults, written mobile-first.
  - Admin uses an undefined `xs:` breakpoint twice.
- **Imagery:**
  - Plain `<img>` everywhere (`next/image` is never used).
  - Each app has its own copy of the PNG logos (`logo.png` 90×51, `logo-light.png` 180×102). `logo-light.png` is just a bigger copy of the purple logo, not a white version, and there is no SVG logo.
  - Spaces without photos fall back to stock images.
- **PWA install assets:**
  - The manifest names the app "DAIH Member Experience" and starts at `/dashboard`.
  - All six icon entries point to one 68×40 PNG declared as 192×192 and 512×512 (maskable), so browsers reject them as install icons.
- **Theming:** no dark mode. Admin and reception declare `darkMode: "class"`, but no `dark:` styles exist.

**Direction:**

- Produce SVG logos (purple and white) and correct 192/512 maskable PNG icons.
- Move images to `next/image`.
- Make reception a kiosk: fullscreen, wake-lock, and auto-clear of member details after a timeout.

## 7. Accessibility

`DAIH_Milestone_Plan.md` marks an accessibility pass across all four front ends as done. The code does not support that yet:

| Area          | Current                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Focus         | No `focus-visible` styles; `focus:ring-2` on some controls (admin 175, member app 80), many custom controls show no focus at all |
| Form labels   | Member-app auth forms link labels; admin has 175 `<label>`s but only 9 `htmlFor`                                                 |
| Dialogs       | No `role="dialog"`/`aria-modal`; no focus traps; only the shared `Modal` and `UserPhotoModal` close on Escape                    |
| Navigation    | No `aria-current` on active links; icon-only buttons often rely on `title`                                                       |
| Icon fonts    | Admin's Material Symbols are not `aria-hidden`, so screen readers announce ligature text such as "bar_chart"                     |
| Contrast      | See [§2.2](#22-contrast)                                                                                                         |
| Touch targets | Member-app top-bar buttons 32px; kiosk mode tabs ≈28px and refresh 22px (main kiosk actions ≈46px are fine)                      |
| Errors        | `alert()` used for errors (member app 8×, kiosk 3×)                                                                              |
| Motion        | No `prefers-reduced-motion` handling (web uses animate.css + WOW.js)                                                             |

**Direction (acceptance bar for new work):** WCAG 2.2 AA.

- Contrast of at least 4.5:1 for text.
- Visible `focus-visible` rings.
- Inputs linked to their labels and errors (`htmlFor`, `aria-describedby`, `aria-invalid`).
- Dialogs with `role="dialog"`, `aria-modal`, a focus trap and Escape-to-close.
- `aria-current` on nav links.
- Touch targets of at least 44px.
- Toasts instead of `alert()`.
- Reduced motion respected.

## 8. Content and tone

- **One name.** Use "The Dare Adeboye Innovation Hub (DAIH)". The code currently also says:
  - "Dominion Allianze Innovation Hub" (member app `/support` and `/security`).
  - "Dev & AI Innovation Hub" (the published policy text).
- **One contact set.** Support email appears as `support@daih.ng` (member app), `support@daih.com.ng` (PDF statements), and `privacy@daih.hub` / `dpo@daih.hub` (policy text). The live domain is `daihworkspace.com`.
- **Money and coins.** Write naira as `₦` with thousands separators. Coins are "PeeDee Coins" (`PD`), with 1 PD worth ₦1 by default.
- **Claims must be true.** These are hardcoded for every user or plan, whatever the data says. They should come from data or be removed:
  - "Premium Member" under every customer's name.
  - "Verified" / "Premium" badges and "24/7 Power Supply & WiFi" on every plan.
  - The security claims on `/security`.
- **Voice.** Plain, warm and brief. Say what happened and what to do next ("Your booking is held for 10 minutes — pay to confirm"), not internal state names.
