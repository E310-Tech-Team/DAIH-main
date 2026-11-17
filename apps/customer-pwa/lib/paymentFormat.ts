/**
 * Display formatting for payment screens. Times are always shown in Lagos time,
 * whatever the member's device time zone, because deadlines are set in Lagos.
 */

const LAGOS_TIME_ZONE = "Africa/Lagos";
const NAIRA_SIGN = "₦";
const RANGE_SEPARATOR = " – ";

const nairaNumberFormat = new Intl.NumberFormat("en-NG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// hourCycle "h12" gives "12:30 pm"; `hour12: true` makes en-GB print "0:30 pm".
const lagosDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LAGOS_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});

interface LagosDateParts {
  /** "Tue 18 Nov" */
  day: string;
  /** "2026" */
  year: string;
  /** "2:30 pm" */
  time: string;
}

function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLagosParts(date: Date): LagosDateParts {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> =
    Object.fromEntries(
      lagosDateTimeFormat
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
  const dayPeriod = (parts.dayPeriod ?? "").toLowerCase();
  return {
    day: `${parts.weekday} ${parts.day} ${parts.month}`,
    year: parts.year ?? "",
    time: `${parts.hour}:${parts.minute} ${dayPeriod}`.trim(),
  };
}

/** "₦12,500.00": thousands separators and kobo, as on a bank statement. */
export function formatNaira(amount: number): string {
  if (!Number.isFinite(amount)) return `${NAIRA_SIGN}—`;
  return `${NAIRA_SIGN}${nairaNumberFormat.format(amount)}`;
}

/** Plain digits for a banking app's amount field: "12500" or "12500.50". */
export function formatAmountForCopy(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** "Tue 18 Nov, 2:30 pm" in Lagos time; the raw value if it is not a date. */
export function formatLagosDateTime(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const { day, time } = toLagosParts(date);
  return `${day}, ${time}`;
}

/**
 * A booking's time window in Lagos time: "Tue 18 Nov, 9:00 am – 5:00 pm",
 * both days when it spans several, and years when it crosses into a new one.
 */
export function formatLagosSessionWindow(
  startIso: string,
  endIso: string,
): string {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return "";

  const from = toLagosParts(start);
  const to = toLagosParts(end);
  if (from.year !== to.year) {
    return `${from.day} ${from.year}, ${from.time}${RANGE_SEPARATOR}${to.day} ${to.year}, ${to.time}`;
  }
  if (from.day === to.day) {
    return `${from.day}, ${from.time}${RANGE_SEPARATOR}${to.time}`;
  }
  return `${from.day}, ${from.time}${RANGE_SEPARATOR}${to.day}, ${to.time}`;
}
