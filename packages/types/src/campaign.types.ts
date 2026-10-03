export enum CampaignType {
  WELCOME_SERIES = "WELCOME_SERIES",
  INACTIVE_30D = "INACTIVE_30D",
  BIRTHDAY = "BIRTHDAY",
  STREAK_ACHIEVEMENT = "STREAK_ACHIEVEMENT",
  ABANDONED_BOOKING = "ABANDONED_BOOKING",
  MILESTONE_TIER = "MILESTONE_TIER",
  CUSTOM_BROADCAST = "CUSTOM_BROADCAST",
}

export enum CampaignTriggerType {
  EVENT = "EVENT",
  SCHEDULED_CRON = "SCHEDULED_CRON",
  MANUAL = "MANUAL",
}

export enum CampaignChannel {
  EMAIL = "EMAIL",
  IN_APP = "IN_APP",
  BOTH = "BOTH",
}

export enum CampaignStatus {
  DRAFT = "DRAFT",
  SCHEDULED = "SCHEDULED",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  COMPLETED = "COMPLETED",
  ARCHIVED = "ARCHIVED",
}

export enum CampaignExecutionStatus {
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
  DEFERRED_QUIET_HOURS = "DEFERRED_QUIET_HOURS",
  SUPPRESSED_FREQUENCY_CAP = "SUPPRESSED_FREQUENCY_CAP",
  SUPPRESSED_BUDGET_CAP = "SUPPRESSED_BUDGET_CAP",
  SUPPRESSED_HOLDOUT = "SUPPRESSED_HOLDOUT",
}

export enum RfmTier {
  CHAMPION = "CHAMPION",
  LOYAL_MEMBER = "LOYAL_MEMBER",
  POTENTIAL_LOYALIST = "POTENTIAL_LOYALIST",
  RECENT_CUSTOMER = "RECENT_CUSTOMER",
  AT_RISK = "AT_RISK",
  HIBERNATING = "HIBERNATING",
  LOST = "LOST",
}

export interface RfmScoreDTO {
  userId: string;
  recencyDays: number;
  frequencyBookings: number;
  monetaryTotalNgn: number;
  rScore: number; // 1-5
  fScore: number; // 1-5
  mScore: number; // 1-5
  rfmTier: RfmTier;
  calculatedAt: string;
}

export interface AudienceFilterDTO {
  rfmTiers?: RfmTier[];
  inactiveDaysMin?: number;
  inactiveDaysMax?: number;
  hasReferredFriends?: boolean;
  minCompletedBookings?: number;
  resourceCategory?: string;
  hasBirthdayInMonth?: boolean;
  customSegmentTag?: string;
}

export interface CampaignDTO {
  id: string;
  name: string;
  description?: string | null;
  type: CampaignType;
  triggerType: CampaignTriggerType;
  channel: CampaignChannel;
  status: CampaignStatus;
  subject?: string | null;
  body: string;
  coinReward?: number | null;
  discountPercentage?: number | null;
  isDiscretionary: boolean;
  frequencyCapDays: number;
  budgetLimitNgn?: number | null;
  spentBudgetNgn: number;
  holdoutPercentage: number;
  aiGenerated: boolean;
  aiPrompt?: string | null;
  aiApprovedByUserId?: string | null;
  aiApprovedAt?: string | null;
  audienceFilter?: AudienceFilterDTO | null;
  scheduledAt?: string | null;
  lastRunAt?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  metrics?: CampaignMetricDTO[];
}

export interface CreateCampaignDTO {
  name: string;
  description?: string;
  type: CampaignType;
  triggerType?: CampaignTriggerType;
  channel?: CampaignChannel;
  subject?: string;
  body: string;
  coinReward?: number;
  discountPercentage?: number;
  isDiscretionary?: boolean;
  frequencyCapDays?: number;
  budgetLimitNgn?: number;
  holdoutPercentage?: number;
  aiGenerated?: boolean;
  aiPrompt?: string;
  audienceFilter?: AudienceFilterDTO;
  scheduledAt?: string;
  status?: CampaignStatus;
}

export interface UpdateCampaignDTO {
  name?: string;
  description?: string;
  subject?: string;
  body?: string;
  coinReward?: number;
  discountPercentage?: number;
  isDiscretionary?: boolean;
  frequencyCapDays?: number;
  budgetLimitNgn?: number;
  holdoutPercentage?: number;
  audienceFilter?: AudienceFilterDTO;
  scheduledAt?: string;
  status?: CampaignStatus;
}

export interface CampaignExecutionDTO {
  id: string;
  campaignId: string;
  recipientUserId: string;
  channel: CampaignChannel;
  status: CampaignExecutionStatus;
  isHoldout: boolean;
  deferredUntil?: string | null;
  coinAwarded?: number | null;
  sentAt?: string | null;
  convertedAt?: string | null;
  conversionAmount?: number | null;
  createdAt: string;
}

export interface CampaignMetricDTO {
  id: string;
  campaignId: string;
  period: string;
  totalTargeted: number;
  treatmentSent: number;
  holdoutCount: number;
  treatmentConversions: number;
  holdoutConversions: number;
  treatmentRevenue: number;
  holdoutRevenue: number;
  treatmentConversionRate: number;
  holdoutConversionRate: number;
  incrementalLift: number; // treatmentConversionRate - holdoutConversionRate
  revenueLiftNgn: number;
}

export interface GenerateCopyRequestDTO {
  campaignType: CampaignType;
  goal: string;
  tone?: "enthusiastic" | "professional" | "urgent" | "friendly";
  targetAudienceDescription?: string;
  coinReward?: number;
  discountPercentage?: number;
}

export interface GenerateCopyResponseDTO {
  subject: string;
  body: string;
  previewText: string;
  confidenceScore?: number;
}
