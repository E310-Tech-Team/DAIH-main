/** Shared button looks: 44px touch targets and a visible keyboard focus ring. */
const BUTTON_BASE =
  "inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-[#23055c] text-white shadow-xs hover:bg-[#392271] focus-visible:ring-[#23055c]`;

export const SECONDARY_BUTTON = `${BUTTON_BASE} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-[#23055c]`;

export const DANGER_BUTTON = `${BUTTON_BASE} bg-rose-600 text-white shadow-xs hover:bg-rose-700 focus-visible:ring-rose-600`;

export const DANGER_OUTLINE_BUTTON = `${BUTTON_BASE} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-600`;
