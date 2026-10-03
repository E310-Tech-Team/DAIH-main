"use client";

import React, { useState } from "react";
import {
  X,
  Sparkles,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Megaphone,
  Moon,
  Clock,
  Coins,
  Percent,
  Sliders,
} from "lucide-react";
import { useToast } from "@daih/ui";
import { api } from "@daih/api-client";
import {
  CampaignType,
  CampaignChannel,
  CampaignTriggerType,
  CreateCampaignDTO,
  RfmTier,
} from "@daih/types";
import { AiCopyModal } from "./AiCopyModal";

interface PresetConfig {
  name: string;
  description: string;
  defaultTrigger: CampaignTriggerType;
  defaultTriggerLabel: string;
  defaultCoinReward?: number;
  defaultDiscount?: number;
  audienceRuleTitle: string;
  audienceRuleDescription: string;
  isCustom: boolean;
}

const PRESET_CONFIGS: Record<CampaignType, PresetConfig> = {
  [CampaignType.WELCOME_SERIES]: {
    name: "New Member Welcome Series",
    description: "Day 0 & Day 3 onboarding messages with welcome bonus",
    defaultTrigger: CampaignTriggerType.EVENT,
    defaultTriggerLabel: "Event-Driven (On Sign-up)",
    defaultCoinReward: 20,
    defaultDiscount: 10,
    audienceRuleTitle: "New Unconverted Registrations",
    audienceRuleDescription:
      "Targeted automatically: Customers registered within the last 7 days with zero (0) confirmed bookings.",
    isCustom: false,
  },
  [CampaignType.INACTIVE_30D]: {
    name: "45-Day Member Inactivity Winback",
    description:
      "Re-engage past workspace members who have not visited in 45+ days",
    defaultTrigger: CampaignTriggerType.SCHEDULED_CRON,
    defaultTriggerLabel: "Scheduled Worker (Daily Check)",
    defaultDiscount: 15,
    defaultCoinReward: 250,
    audienceRuleTitle: "Dormant Past Members",
    audienceRuleDescription:
      "Targeted automatically: Members who previously completed bookings but haven't visited in ≥ 45 days.",
    isCustom: false,
  },
  [CampaignType.BIRTHDAY]: {
    name: "Member Birthday Celebration",
    description: "Celebrate members on their special day with bonus coins",
    defaultTrigger: CampaignTriggerType.SCHEDULED_CRON,
    defaultTriggerLabel: "Scheduled Worker (Daily 08:05 WAT)",
    defaultCoinReward: 50,
    audienceRuleTitle: "Today's Birthdays",
    audienceRuleDescription:
      "Targeted automatically: Verified members whose registered birthday matches today's date (MM-DD).",
    isCustom: false,
  },
  [CampaignType.STREAK_ACHIEVEMENT]: {
    name: "Visit Streak Milestone Celebration",
    description:
      "Reward recurring monthly visit habits (4 check-ins in 30 days)",
    defaultTrigger: CampaignTriggerType.EVENT,
    defaultTriggerLabel: "Event-Driven (On Check-in)",
    defaultCoinReward: 30,
    audienceRuleTitle: "Monthly Streak Achievers",
    audienceRuleDescription:
      "Targeted automatically: Active members achieving 4 check-ins within a 30-day period (calendar month). Check-ins do not need to be on consecutive days.",
    isCustom: false,
  },
  [CampaignType.ABANDONED_BOOKING]: {
    name: "Abandoned Booking Hold Recovery",
    description:
      "Recover bookings where temporary holds expired without payment",
    defaultTrigger: CampaignTriggerType.EVENT,
    defaultTriggerLabel: "Event-Driven (On Hold Expiry)",
    audienceRuleTitle: "Unpaid Booking Holds",
    audienceRuleDescription:
      "Targeted automatically: Customers who created a temporary booking hold that expired in the last 24h without payment.",
    isCustom: false,
  },
  [CampaignType.MILESTONE_TIER]: {
    name: "Gold Tier Milestone Celebration",
    description:
      "Congratulate members when reaching Gold tier (1,000+ PD lifetime earned)",
    defaultTrigger: CampaignTriggerType.EVENT,
    defaultTriggerLabel: "Event-Driven (On Tier Upgrade)",
    audienceRuleTitle: "Gold Tier Members",
    audienceRuleDescription:
      "Targeted automatically: Customers who achieved Gold loyalty tier in the last 24 hours.",
    isCustom: false,
  },
  [CampaignType.CUSTOM_BROADCAST]: {
    name: "Custom Audience Broadcast",
    description:
      "Flexible broadcast targeted by RFM tiers or sent to all members",
    defaultTrigger: CampaignTriggerType.MANUAL,
    defaultTriggerLabel: "Manual or Scheduled Launch",
    audienceRuleTitle: "Custom Audience Segments",
    audienceRuleDescription:
      "Choose specific RFM audience segments below or leave unselected to broadcast to all verified members.",
    isCustom: true,
  },
};

export interface CreateCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CreateCampaignModal: React.FC<CreateCampaignModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const toast = useToast();
  const [type, setType] = useState<CampaignType>(CampaignType.WELCOME_SERIES);
  const [name, setName] = useState(
    PRESET_CONFIGS[CampaignType.WELCOME_SERIES].name,
  );
  const [description, setDescription] = useState(
    PRESET_CONFIGS[CampaignType.WELCOME_SERIES].description,
  );
  const [channel, setChannel] = useState<CampaignChannel>(
    CampaignChannel.EMAIL,
  );
  const [triggerType, setTriggerType] = useState<CampaignTriggerType>(
    PRESET_CONFIGS[CampaignType.WELCOME_SERIES].defaultTrigger,
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [coinReward, setCoinReward] = useState<number | "">(
    PRESET_CONFIGS[CampaignType.WELCOME_SERIES].defaultCoinReward || "",
  );
  const [discountPercentage, setDiscountPercentage] = useState<number | "">(
    PRESET_CONFIGS[CampaignType.WELCOME_SERIES].defaultDiscount || "",
  );

  // Guardrail settings
  const [frequencyCapDays, setFrequencyCapDays] = useState(7);
  const [budgetLimitNgn, setBudgetLimitNgn] = useState<number | "">("");
  const [holdoutPercentage, setHoldoutPercentage] = useState(10);
  const [isDiscretionary, setIsDiscretionary] = useState(true);

  // AI Generation status
  const [aiGenerated, setAiGenerated] = useState(false);
  const [aiPrompt, setAiPrompt] = useState<string | undefined>(undefined);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);

  // Audience filter
  const [selectedTiers, setSelectedTiers] = useState<RfmTier[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentPreset = PRESET_CONFIGS[type];

  const handleTypeChange = (newType: CampaignType) => {
    setType(newType);
    const config = PRESET_CONFIGS[newType];
    if (config) {
      setTriggerType(config.defaultTrigger);
      setCoinReward(
        config.defaultCoinReward !== undefined ? config.defaultCoinReward : "",
      );
      setDiscountPercentage(
        config.defaultDiscount !== undefined ? config.defaultDiscount : "",
      );
      // Update name/desc if user hasn't typed a custom one or was on previous preset
      const isPreviousPresetName = Object.values(PRESET_CONFIGS).some(
        (c) => c.name === name,
      );
      if (!name || isPreviousPresetName) {
        setName(config.name);
      }
      const isPreviousPresetDesc = Object.values(PRESET_CONFIGS).some(
        (c) => c.description === description,
      );
      if (!description || isPreviousPresetDesc) {
        setDescription(config.description);
      }
    }
  };

  if (!isOpen) return null;

  const handleApplyAiCopy = (data: {
    subject: string;
    body: string;
    aiPrompt: string;
  }) => {
    setSubject(data.subject);
    setBody(data.body);
    setAiGenerated(true);
    setAiPrompt(data.aiPrompt);
  };

  const toggleTier = (tier: RfmTier) => {
    setSelectedTiers((prev) =>
      prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a campaign name.");
      return;
    }
    if (!body.trim()) {
      toast.error("Campaign message body is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const dto: CreateCampaignDTO = {
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        channel,
        triggerType,
        subject: subject.trim() || undefined,
        body: body.trim(),
        coinReward: coinReward ? Number(coinReward) : undefined,
        discountPercentage: discountPercentage
          ? Number(discountPercentage)
          : undefined,
        frequencyCapDays,
        budgetLimitNgn: budgetLimitNgn ? Number(budgetLimitNgn) : undefined,
        holdoutPercentage,
        isDiscretionary,
        aiGenerated,
        aiPrompt,
        scheduledAt:
          triggerType === CampaignTriggerType.SCHEDULED_CRON && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : undefined,
        audienceFilter:
          selectedTiers.length > 0
            ? {
                rfmTiers: selectedTiers,
              }
            : undefined,
      };

      await api.campaigns.create(dto);
      toast.success(
        aiGenerated
          ? "Campaign created! Pending staff approval for AI copy before execution."
          : "Campaign created successfully!",
      );
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create campaign");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 relative my-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6 pb-4 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-100 text-[#23055c] flex items-center justify-center font-bold">
                <Megaphone className="w-5 h-5 text-[#23055c]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Create Marketing Campaign
                </h3>
                <p className="text-[11px] text-slate-500">
                  Configure rule-based targeting, 6 guardrails, and AI copy
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
              {/* Campaign Name & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Campaign Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Inactive Member 30-Day Winback"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Type / Template
                  </label>
                  <select
                    value={type}
                    onChange={(e) =>
                      handleTypeChange(e.target.value as CampaignType)
                    }
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                  >
                    <option value={CampaignType.WELCOME_SERIES}>
                      Welcome Series (Day 0 & 3 onboarding)
                    </option>
                    <option value={CampaignType.INACTIVE_30D}>
                      30-Day Inactivity Winback
                    </option>
                    <option value={CampaignType.BIRTHDAY}>
                      Birthday Celebration (500 PD)
                    </option>
                    <option value={CampaignType.STREAK_ACHIEVEMENT}>
                      Streak Reminder / Milestone
                    </option>
                    <option value={CampaignType.ABANDONED_BOOKING}>
                      Abandoned Checkout Recovery
                    </option>
                    <option value={CampaignType.MILESTONE_TIER}>
                      Loyalty Tier Upgrade Celebration
                    </option>
                    <option value={CampaignType.CUSTOM_BROADCAST}>
                      Custom Broadcast (Custom Segments & Triggers)
                    </option>
                  </select>
                </div>
              </div>

              {/* Channel & Trigger Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Channel
                  </label>
                  <select
                    value={channel}
                    onChange={(e) =>
                      setChannel(e.target.value as CampaignChannel)
                    }
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                  >
                    <option value={CampaignChannel.EMAIL}>Email Only</option>
                    <option value={CampaignChannel.IN_APP}>
                      In-App Notification Only
                    </option>
                    <option value={CampaignChannel.BOTH}>
                      Both Email & In-App
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    {currentPreset.isCustom ? "Trigger Type" : "Preset Trigger"}
                  </label>
                  {currentPreset.isCustom ? (
                    <select
                      value={triggerType}
                      onChange={(e) =>
                        setTriggerType(e.target.value as CampaignTriggerType)
                      }
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                    >
                      <option value={CampaignTriggerType.MANUAL}>
                        Manual Launch (Send Immediately)
                      </option>
                      <option value={CampaignTriggerType.SCHEDULED_CRON}>
                        Scheduled Launch (Set Date & Time)
                      </option>
                    </select>
                  ) : (
                    <div className="w-full border border-purple-200 bg-purple-50/60 rounded-xl px-3 py-2 text-[11px] text-purple-900 font-bold flex items-center gap-1.5 min-h-[38px]">
                      <Sparkles className="w-3.5 h-3.5 text-[#23055c] shrink-0" />
                      <span className="truncate">
                        {currentPreset.defaultTriggerLabel}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Scheduled Launch Time (Visible when Scheduled Worker is selected on custom broadcasts) */}
              {currentPreset.isCustom &&
                triggerType === CampaignTriggerType.SCHEDULED_CRON && (
                  <div className="bg-purple-50/70 border border-purple-100 rounded-xl p-3 space-y-1.5 animate-in fade-in duration-150">
                    <label className="block text-[11px] font-bold text-purple-900 uppercase">
                      Scheduled Launch Time (WAT / UTC+1){" "}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="w-full border border-purple-200 rounded-xl px-3 py-2 bg-white text-slate-800 outline-none focus:border-[#23055c] text-xs font-semibold"
                    />
                    <p className="text-[10px] text-purple-700">
                      The automated background worker will execute this campaign
                      at the specified date & time, evaluating matching audience
                      members and respecting quiet hours (21:00 – 08:00 WAT).
                    </p>
                  </div>
                )}

              {/* Incentives */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Coin Reward (PD)
                  </label>
                  <input
                    type="number"
                    value={coinReward}
                    onChange={(e) =>
                      setCoinReward(
                        e.target.value ? Number(e.target.value) : "",
                      )
                    }
                    placeholder="e.g. 500 PD bonus"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Discount Percentage (%)
                  </label>
                  <input
                    type="number"
                    value={discountPercentage}
                    onChange={(e) =>
                      setDiscountPercentage(
                        e.target.value ? Number(e.target.value) : "",
                      )
                    }
                    placeholder="e.g. 15%"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                  />
                </div>
              </div>

              {/* 6 Guardrails Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#23055c]" />
                  <span>6 Policy Guardrails & Protections:</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  {/* Quiet Hours */}
                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Moon className="w-3 h-3 text-purple-600" />
                      Quiet Hours
                    </span>
                    <span className="font-bold text-[#23055c] mt-1">
                      21:00 &mdash; 08:00 WAT
                    </span>
                    <span className="text-[9px] text-slate-400">
                      Defers to 08:05 WAT
                    </span>
                  </div>

                  {/* Frequency Cap */}
                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-600" />
                      Frequency Cap
                    </span>
                    <span className="font-bold text-slate-800 mt-1">
                      {frequencyCapDays} Days
                    </span>
                    <span className="text-[9px] text-slate-400">
                      Max 1 msg per user
                    </span>
                  </div>

                  {/* Holdout */}
                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col justify-between">
                    <span className="text-slate-500">Holdout Group</span>
                    <span className="font-bold text-slate-800 mt-1">
                      {holdoutPercentage}% Control
                    </span>
                    <span className="text-[9px] text-slate-400">
                      Uncontacted lift baseline
                    </span>
                  </div>

                  {/* Budget Limit */}
                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col justify-between">
                    <span className="text-slate-500">Budget Limit</span>
                    <input
                      type="number"
                      value={budgetLimitNgn}
                      onChange={(e) =>
                        setBudgetLimitNgn(
                          e.target.value ? Number(e.target.value) : "",
                        )
                      }
                      placeholder="Unlimited"
                      className="font-bold text-slate-800 mt-0.5 text-xs bg-transparent outline-none w-full border-b border-dashed border-slate-300"
                    />
                    <span className="text-[9px] text-slate-400">
                      Max fiat cap
                    </span>
                  </div>
                </div>
              </div>

              {/* Target Audience: Automated Rule vs Custom RFM Tiers */}
              {currentPreset.isCustom ? (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase">
                    Target RFM Audience Segments (Optional &mdash; Leave
                    unselected to broadcast to all members)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { tier: RfmTier.CHAMPION, label: "Champions" },
                      { tier: RfmTier.LOYAL_MEMBER, label: "Loyal Members" },
                      {
                        tier: RfmTier.POTENTIAL_LOYALIST,
                        label: "Potential Loyalists",
                      },
                      { tier: RfmTier.AT_RISK, label: "At Risk" },
                      { tier: RfmTier.HIBERNATING, label: "Hibernating" },
                      { tier: RfmTier.LOST, label: "Lost Members" },
                    ].map((item) => {
                      const active = selectedTiers.includes(item.tier);
                      return (
                        <button
                          key={item.tier}
                          type="button"
                          onClick={() => toggleTier(item.tier)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            active
                              ? "bg-[#23055c] text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Automated Preset Audience:{" "}
                      {currentPreset.audienceRuleTitle}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {currentPreset.audienceRuleDescription}
                  </p>
                </div>
              )}

              {/* Copy Drafting Bar & AI Assistant */}
              <div className="border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 uppercase">
                    Message Content
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAiModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-purple-100 hover:bg-purple-200 text-[#23055c] font-bold text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Load Campaign Template</span>
                  </button>
                </div>

                {aiGenerated && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-[10px] text-purple-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-[#23055c] shrink-0" />
                    <span>
                      Curated template loaded. Staff approval is required before
                      campaign dispatch.
                    </span>
                  </div>
                )}

                {channel !== CampaignChannel.IN_APP && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Subject Line
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g. We miss you at DAIH Hub! Here's 500 PD Coins for your next visit"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Body Message <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Enter message body or use PeeDee AI assistant..."
                    className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c] resize-none"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Sticky Bottom Actions */}
            <div className="flex items-center justify-end gap-3 p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 rounded-b-2xl shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-[#23055c] hover:bg-[#392271] text-white font-bold transition-all flex items-center gap-2 shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Create Campaign</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <AiCopyModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        campaignType={type}
        onApplyCopy={handleApplyAiCopy}
      />
    </>
  );
};
