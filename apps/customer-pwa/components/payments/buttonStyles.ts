/**
 * Button styles shared by the payment screens: 44px touch targets, text-sm
 * labels and a visible brand focus ring. Tailwind's outline-none keeps a
 * transparent outline, so the focus stays visible in forced-colours mode.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23055c] focus-visible:ring-offset-2";

const BUTTON_BASE = `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-center text-sm font-bold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${FOCUS_RING}`;

export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-[#23055c] text-white shadow-sm hover:bg-[#392271]`;

export const SECONDARY_BUTTON = `${BUTTON_BASE} border border-[#23055c]/25 bg-white text-[#23055c] hover:bg-[#ebe7f5]`;

export const DANGER_BUTTON = `${BUTTON_BASE} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`;
