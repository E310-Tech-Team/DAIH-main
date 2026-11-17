/** The hub's local time. Staff read every booking and payment time in it. */
const HUB_TIME_ZONE = "Africa/Lagos";
const EMPTY_VALUE = "—";

const lagosDate = new Intl.DateTimeFormat("en-NG", {
  timeZone: HUB_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const lagosTime = new Intl.DateTimeFormat("en-NG", {
  timeZone: HUB_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const lagosDateTime = new Intl.DateTimeFormat("en-NG", {
  timeZone: HUB_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWith(
  format: Intl.DateTimeFormat,
  iso: string | null | undefined,
): string {
  const date = toDate(iso);
  return date ? format.format(date) : EMPTY_VALUE;
}

/** e.g. "Wed, 18 Nov 2026" in Lagos time. */
export function formatLagosDate(iso: string | null | undefined): string {
  return formatWith(lagosDate, iso);
}

/** e.g. "10:00" (24-hour) in Lagos time. */
export function formatLagosTime(iso: string | null | undefined): string {
  return formatWith(lagosTime, iso);
}

/** e.g. "18 Nov 2026, 10:00" in Lagos time. */
export function formatLagosDateTime(iso: string | null | undefined): string {
  return formatWith(lagosDateTime, iso);
}

/** e.g. "₦12,500.00". */
export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
