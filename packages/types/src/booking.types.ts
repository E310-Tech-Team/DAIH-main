import { WifiCredentialDTO, WifiAccessStatus } from "./access.types";
import { PaymentOption } from "./payment.types";

export enum BookingState {
  DRAFT = "DRAFT",
  HELD = "HELD",
  PENDING_PAYMENT = "PENDING_PAYMENT",
  CONFIRMED = "CONFIRMED",
  ACTIVE = "ACTIVE",
  CHECKED_IN = "CHECKED_IN",
  CHECKED_OUT = "CHECKED_OUT",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
  NO_SHOW = "NO_SHOW",
  REFUND_PENDING = "REFUND_PENDING",
  REFUNDED = "REFUNDED",
}

export enum ResourceCategory {
  HOT_DESK = "HOT_DESK",
  FLEX_DESK = "FLEX_DESK",
  DEDICATED_DESK = "DEDICATED_DESK",
  OFFICE_SUITE = "OFFICE_SUITE",
  CONFERENCE_HALL = "CONFERENCE_HALL",
  TRAINING_ROOM = "TRAINING_ROOM",
  ROOFTOP_LOUNGE = "ROOFTOP_LOUNGE",
  STUDIO = "STUDIO",
}

export enum CalendarDayStatus {
  AVAILABLE = "AVAILABLE",
  LIMITED = "LIMITED",
  FULL = "FULL",
  BLACKOUT = "BLACKOUT",
  CLOSED = "CLOSED",
}

export interface BookingHoldDTO {
  bookingId: string;
  resourceId: string;
  resourceName?: string;
  userId: string;
  startTime: string;
  endTime: string;
  holdExpiresAt: string;
  totalAmount: number;
  originalAmount?: number;
  discountAmount?: number;
  discountCode?: string;
  currency: string;
  reference: string;
  state: BookingState;
}

export interface CreateBookingDTO {
  resourceId: string;
  startTime: string;
  endTime: string;
  planId?: string;
  promoCode?: string;
  notes?: string;
}

export interface AvailabilityQueryDTO {
  resourceId: string;
  startTime: string;
  endTime: string;
}

export interface AvailabilityResultDTO {
  available: boolean;
  resourceId: string;
  resourceName: string;
  category: ResourceCategory;
  capacity: number;
  activeCount: number;
  remainingSpots: number;
  startTime: string;
  endTime: string;
  reason?: string;
}

export interface CalendarAvailabilityQueryDTO {
  resourceId: string;
  month?: string; // YYYY-MM format
}

export interface CalendarDayInfo {
  status: CalendarDayStatus;
  remainingSpots?: number;
  reason?: string;
  bookedHourSlots?: number[]; // Array of booked hours 0-23
}

export interface CalendarAvailabilityResultDTO {
  resourceId: string;
  resourceName: string;
  capacity: number;
  month: string;
  defaultStatus: CalendarDayStatus;
  busyDates: Record<string, CalendarDayInfo>; // Sparse map: YYYY-MM-DD -> Info
}

export interface CancelBookingDTO {
  reason?: string;
}

export interface AdminNoShowRescheduleDTO {
  newStartTime: string;
  newEndTime: string;
  reason: string;
}

export interface DashboardSubscriptionMetric {
  name: string;
  count: number;
  percentage: number;
  revenueContribution: string;
  colorClass: string;
  barColorClass: string;
}

export interface DashboardFacilityMetric {
  name: string;
  category: string;
  bookingsCount: number;
  utilizationRate: number;
  totalRevenue: string;
}

export interface DashboardActivityRecord {
  id: string;
  bookingId?: string;
  memberName: string;
  memberEmail: string;
  clientNumber: string;
  resourceName: string;
  workspaceCategory?: string;
  eventType: "CHECK_IN" | "CHECK_OUT" | "AUTO_CHECK_OUT" | "RE_ENTRY";
  timestamp: string;
  formattedTime: string;
  checkInTime?: string;
  checkOutTime?: string | null;
  formattedCheckIn?: string;
  formattedCheckOut?: string | null;
  hoursUsed?: string;
  amountPaid?: string;
  paymentStatus?: string;
}

export interface AdminDashboardSummaryDTO {
  dailyVisitors: number;
  currentlyOnSite: number;
  todayDeparturesCount: number;
  todayBookingsCount: number;
  revenueToday: string;
  totalRevenueMtd: string;
  occupancyRate: number;
  occupiedSeats: number;
  totalSeats: number;
  peakHourWindow: string;
  peakOccupancyRate: number;
  subscriptionPlans: DashboardSubscriptionMetric[];
  mostUsedFacilities: DashboardFacilityMetric[];
  recentActivities: DashboardActivityRecord[];
}

export interface AdminAnalyticsPeriodMetrics {
  totalRevenue: string;
  rawTotalRevenue: number;
  totalBookingsCount: number;
  paidBookingsCount: number;
  totalCheckIns: number;
  totalCustomersCount: number;
  avgDailyFootfall: string;
  spaceOccupancyRate: number;
  totalCapacity: number;
  repeatRate: string;
  repeatMembersCount: number;
  avgBookingValue: string;
}

export interface DashboardFacilityRankingDTO {
  id: string;
  name: string;
  type: string;
  category?: string;
  utilizationRate: number;
  paidBookingsCount: number;
  bookingsCount?: number;
  totalRevenue?: string;
  activeOccupancy: string;
  status: "High Demand" | "Active" | "Available";
  barColorClass: string;
}

export interface AdminAnalyticsSummaryDTO {
  periodMetrics: AdminAnalyticsPeriodMetrics;
  subscriptionPlans: DashboardSubscriptionMetric[];
  facilityRankings: DashboardFacilityRankingDTO[];
  bookings: BookingSummary[];
  transactions: any[];
}

export interface AdminOverrideBookingDTO {
  resourceId: string;
  customerEmail?: string;
  userId?: string;
  startTime: string;
  endTime: string;
  planId?: string;
  totalAmount?: number;
  currency?: string;
  state?: BookingState.HELD | BookingState.CONFIRMED;
  overrideReason: string;
  waiveFee?: boolean;
}

export interface BookingFilterDTO {
  state?: BookingState | string;
  status?: BookingState | string;
  resourceId?: string;
  userId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface BookingSummary {
  id: string;
  reference: string;
  resourceId: string;
  resourceName: string;
  category: ResourceCategory;
  userId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  startTime: string;
  endTime: string;
  state: BookingState;
  qrToken?: string;
  amount: number;
  originalAmount?: number;
  discountAmount?: number;
  discountCode?: string;
  currency: string;
  /** What is still to be paid in cash after discounts and coins. */
  cashDue?: number;
  /** How the member chose to pay at checkout, if they have chosen. */
  paymentOption?: PaymentOption | null;
  holdExpiresAt?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  checkedInToday?: boolean;
  wifiStatus?: WifiAccessStatus;
  wifiCredentials?: WifiCredentialDTO | null;
  createdAt: string;
  updatedAt?: string;
}
