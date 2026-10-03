"use client";

import React, { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  CheckCircle2,
  Copy,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { useToast } from "@daih/ui";
import { api } from "@daih/api-client";
import {
  CampaignType,
  GenerateCopyRequestDTO,
  GenerateCopyResponseDTO,
} from "@daih/types";

export interface AiCopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignType: CampaignType;
  onApplyCopy: (data: {
    subject: string;
    body: string;
    aiPrompt: string;
  }) => void;
}

export const AiCopyModal: React.FC<AiCopyModalProps> = ({
  isOpen,
  onClose,
  campaignType,
  onApplyCopy,
}) => {
  const toast = useToast();
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState<
    "enthusiastic" | "professional" | "urgent" | "friendly"
  >("friendly");
  const [audienceDesc, setAudienceDesc] = useState("");
  const [coinReward, setCoinReward] = useState<number | "">("");
  const [discountPercent, setDiscountPercent] = useState<number | "">("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] =
    useState<GenerateCopyResponseDTO | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) {
      toast.error("Please describe the goal of this campaign.");
      return;
    }

    setIsGenerating(true);
    try {
      const payload: GenerateCopyRequestDTO = {
        campaignType,
        goal: goal.trim(),
        tone,
        targetAudienceDescription: audienceDesc.trim() || undefined,
        coinReward: coinReward ? Number(coinReward) : undefined,
        discountPercentage: discountPercent
          ? Number(discountPercent)
          : undefined,
      };

      const res = await api.campaigns.generateAiCopy(payload);
      const result = (
        (res as any)?.data !== undefined ? (res as any).data : res
      ) as GenerateCopyResponseDTO;
      if (result && result.subject) {
        setGeneratedResult(result);
        toast.success("AI draft generated successfully!");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate AI copy");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (!generatedResult) return;
    onApplyCopy({
      subject: generatedResult.subject,
      body: generatedResult.body,
      aiPrompt: `Goal: ${goal} | Tone: ${tone}`,
    });
    toast.success(
      "Copy applied to campaign! Remember staff approval is required.",
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 relative my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-100 text-[#23055c] flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5 text-[#23055c]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Curated Campaign Template Assistant
              </h3>
              <p className="text-[11px] text-slate-500">
                Select brand-aligned messaging and offers for your campaign
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

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
          {/* Form Inputs */}
          <form onSubmit={handleGenerate} className="space-y-4 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Campaign Goal <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Welcome new member with 500 PeeDee Coins & invite them to book an open desk"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Tone of Voice
                </label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                >
                  <option value="friendly">Friendly & Warm</option>
                  <option value="enthusiastic">
                    Enthusiastic & Energizing
                  </option>
                  <option value="professional">Professional & Direct</option>
                  <option value="urgent">Urgent & Limited-Time</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Coin Incentive (Optional)
                </label>
                <input
                  type="number"
                  value={coinReward}
                  onChange={(e) =>
                    setCoinReward(e.target.value ? Number(e.target.value) : "")
                  }
                  placeholder="e.g. 500 PD"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:bg-white focus:border-[#23055c]"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isGenerating}
                className="px-4 py-2 rounded-xl bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {isGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {isGenerating
                    ? "Loading Template..."
                    : "Load Curated Template"}
                </span>
              </button>
            </div>
          </form>

          {/* Generated Result Preview */}
          {generatedResult && (
            <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-4 space-y-3 text-xs animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#23055c] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-700" />
                  Curated Campaign Template
                </span>
                <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                  Verified Template
                </span>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">
                  Subject Line
                </span>
                <div className="font-semibold text-slate-900 bg-white p-2.5 rounded-lg border border-purple-100">
                  {generatedResult.subject}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">
                  Message Body
                </span>
                <div className="text-slate-800 bg-white p-2.5 rounded-lg border border-purple-100 leading-relaxed whitespace-pre-wrap font-normal">
                  {generatedResult.body}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <p className="text-[10px] text-purple-800 italic">
                  * Note: Human approval gate is enforced before campaign
                  execution.
                </p>
                <button
                  type="button"
                  onClick={handleApply}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Use This Copy</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
