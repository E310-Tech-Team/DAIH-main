import {
  BookingState,
  PaymentStatus,
  type PendingBankTransfer,
} from "@daih/types";

/** The transfer lists the API serves (GET /payments/admin/bank-transfers?status=). */
export type TransferListStatus =
  | PaymentStatus.PENDING
  | PaymentStatus.EXPIRED
  | PaymentStatus.ABANDONED
  | PaymentStatus.FAILED;

export interface TransferTab {
  status: TransferListStatus;
  label: string;
  /** One line under the tabs explaining what this list holds and what to do. */
  summary: string;
  emptyMessage: string;
  /** Finance can still confirm or reject the transfers in this list. */
  isActionable: boolean;
}

export const TRANSFER_TABS: readonly TransferTab[] = [
  {
    status: PaymentStatus.PENDING,
    label: "Awaiting",
    summary:
      "Members have been shown the hub's bank details. Confirm a transfer only once the money is on the bank statement.",
    emptyMessage: "No transfers are waiting for confirmation.",
    isActionable: true,
  },
  {
    status: PaymentStatus.EXPIRED,
    label: "Expired",
    summary:
      "The hold ran out before anyone confirmed. If the money did arrive, you can still confirm it up to 14 days after the transfer was opened; otherwise reject it to close it.",
    emptyMessage: "No expired transfers.",
    isActionable: true,
  },
  {
    status: PaymentStatus.ABANDONED,
    label: "Abandoned",
    summary:
      "The member switched to another way to pay. Confirm only if money for this reference arrived anyway; otherwise reject it to close it.",
    emptyMessage: "No abandoned transfers.",
    isActionable: true,
  },
  {
    status: PaymentStatus.FAILED,
    label: "Rejected",
    summary: "Transfers finance closed because no matching money arrived.",
    emptyMessage: "No rejected transfers.",
    isActionable: false,
  },
];

/** Booking states where confirming re-checks availability instead of simply confirming the booking. */
const NO_LONGER_HELD_STATES: ReadonlySet<string> = new Set<string>([
  BookingState.EXPIRED,
  BookingState.CANCELLED,
  BookingState.CONFIRMED,
]);

export function isBookingNoLongerHeld(state: string): boolean {
  return NO_LONGER_HELD_STATES.has(state);
}

export function transferTabId(status: TransferListStatus): string {
  return `bank-transfers-tab-${status.toLowerCase()}`;
}

/** Case-insensitive match on the reference, member and booking, as finance reads them off a statement. */
export function matchesTransferSearch(
  transfer: PendingBankTransfer,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    transfer.reference,
    transfer.member.name,
    transfer.member.email,
    transfer.member.clientId,
    transfer.booking.reference,
    transfer.booking.resourceName,
  ];
  return haystack.some((value) => value?.toLowerCase().includes(needle));
}
