import { BookingState } from "./booking.types";
import { PaymentOption } from "./payment.types";

export enum AccessRejectionReason {
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  BOOKING_NOT_FOUND = "BOOKING_NOT_FOUND",
  UNPAID = "UNPAID",
  CANCELLED = "CANCELLED",
  TOO_EARLY = "TOO_EARLY",
  EXPIRED = "EXPIRED",
  NO_SHOW = "NO_SHOW",
  COMPLETED = "COMPLETED",
  FORBIDDEN = "FORBIDDEN",
}

export type WifiAccessStatus =
  "ACTIVE" | "LOCKED_PENDING_DAILY_CHECKIN" | "EXPIRED" | "LOCKED_NO_PASS";

export type WifiLockReason =
  "REQUIRES_DAILY_CHECKIN" | "SUBSCRIPTION_EXPIRED" | "NO_ACTIVE_RESERVATION";

export interface WifiCredentialDTO {
  ssid: string;
  username?: string;
  pin: string;
  validUntil: string;
  status: WifiAccessStatus;
  instructions: string;
}

export interface VisitSessionDTO {
  id: string;
  bookingId: string;
  userId: string;
  staffUserId?: string | null;
  terminalId?: string | null;
  checkInTime: string;
  checkOutTime?: string | null;
  ipAddress?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessPassDetails {
  bookingId: string;
  reference: string;
  resourceId: string;
  resourceName: string;
  category?: string;
  resourceLocation?: string;
  resourceCapacity?: number;
  userId: string;
  clientId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  startTime: string;
  endTime: string;
  state: BookingState;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  checkedInToday: boolean;
  activeVisitSession?: VisitSessionDTO | null;
  visitCount?: number;
  wifiStatus: WifiAccessStatus;
  wifiCredentials: WifiCredentialDTO | null;

  // Enriched booking metadata for reception clarity (financial details excluded)
  dailySlotHours?: string;
  dailySlotStart?: string;
  dailySlotEnd?: string;
  isSlotConcludedToday?: boolean;
  isMultiDay?: boolean;
  totalDays?: number;
  currentDayNumber?: number;
  planName?: string;
  visitSessionsHistory?: Array<{
    id: string;
    checkInTime: string;
    checkOutTime?: string | null;
    durationMinutes?: number;
  }>;
}

export interface VerifyAccessPassResponse {
  valid: boolean;
  rejectionReason?: AccessRejectionReason;
  rejectionTitle?: string;
  rejectionMessage?: string;
  rejectionDetails?: {
    scheduledStartTime?: string;
    scheduledEndTime?: string;
    policyNotice?: string;
    auditProof?: {
      bookingReference: string;
      unredeemedWindow: string;
      scannedAt: string;
      receptionTerminal: string;
    };
    adminRescheduleAvailable?: boolean;
    isDailySlotRejection?: boolean;
    dailySlotWindow?: string;
    nextAvailableCheckIn?: string;
  };
  booking?: AccessPassDetails;
  canCheckIn?: boolean;
  canCheckOut?: boolean;
  /** Present on UNPAID results: what reception can collect before check-in. */
  paymentDue?: {
    amount: number;
    currency: string;
    paymentOption: PaymentOption | null;
    /** True when reception is allowed to take cash or POS for this booking. */
    canRecordPayment: boolean;
  };
  isReEntry?: boolean;
}

export interface CheckInResultDTO {
  success: boolean;
  action: "CHECKED_IN";
  isReEntry: boolean;
  booking: AccessPassDetails;
  visitSession: VisitSessionDTO;
  wifiCredentials: WifiCredentialDTO;
  timestamp: string;
}

export interface CheckOutResultDTO {
  success: boolean;
  action: "CHECKED_OUT";
  booking: AccessPassDetails;
  visitSession: VisitSessionDTO;
  timestamp: string;
  wifiStatus: "CONTINUOUS_ACTIVE_UNTIL_END_TIME";
  wifiValidUntil: string;
}

export interface TerminalActivityRecord {
  id: string;
  bookingId: string;
  bookingReference: string;
  customerName: string;
  clientId?: string;
  resourceName: string;
  action: "CHECK_IN" | "CHECK_OUT" | "RE_CHECK_IN" | "REJECTED_SCAN";
  timestamp: string;
  terminalId: string;
  staffName?: string;
  notes?: string;
}

export interface ResourceOccupancyItem {
  resourceId: string;
  resourceName: string;
  category: string;
  capacity: number;
  currentOccupancy: number;
  availableSpots: number;
  occupancyRate: number;
}

export interface LiveOccupancyDTO {
  totalCapacity: number;
  totalCheckedIn: number;
  overallOccupancyRate: number;
  timestamp: string;
  resources: ResourceOccupancyItem[];
}

export interface ReceptionShiftMetrics {
  todayCheckedInCount: number;
  currentlyOnSiteCount: number;
  todayDeparturesCount: number;
  expectedArrivalsRemaining: number;
  totalShiftCapacity: number;
  occupancyRate: number;
}

export interface ReceptionTerminalSummaryDTO {
  shiftMetrics: ReceptionShiftMetrics;
  occupancy: LiveOccupancyDTO;
  recentActivity: TerminalActivityRecord[];
  timestamp: string;
}

export interface VisitLogItemDTO {
  id: string;
  bookingId: string;
  bookingReference: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  clientId?: string | null;
  resourceName: string;
  resourceCategory?: string | null;
  checkInTime: string;
  checkOutTime?: string | null;
  durationMinutes?: number | null;
  isOnSite: boolean;
  terminalId?: string | null;
  staffName?: string | null;
  notes?: string | null;
}

export interface VisitActivityResponse {
  items: VisitLogItemDTO[];
  total: number;
  currentlyOnSiteCount: number;
  todayTotalCount: number;
}
