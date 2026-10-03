"use client";

import React, { useState, useEffect } from "react";
import {
  Star,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { api } from "@daih/api-client";
import { ReviewDTO, BookingSummary } from "@daih/types";

interface ReviewModalProps {
  isOpen: boolean;
  booking: BookingSummary | null;
  existingReview?: ReviewDTO | null;
  onClose: () => void;
  onSuccess: () => void;
}

const RATING_LABELS: Record<number, string> = {
  1: "Poor experience",
  2: "Fair, needs improvement",
  3: "Good workspace",
  4: "Very good & productive",
  5: "Exceptional / Highly recommended!",
};

export function ReviewModal({
  isOpen,
  booking,
  existingReview,
  onClose,
  onSuccess,
}: ReviewModalProps) {
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [title, setTitle] = useState<string>("");
  const [comment, setComment] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existingReview) {
      setRating(existingReview.rating || 5);
      setTitle(existingReview.title || "");
      setComment(existingReview.comment || "");
    } else {
      setRating(5);
      setTitle("");
      setComment("");
    }
    setError(null);
  }, [existingReview, isOpen]);

  if (!isOpen || !booking) return null;

  const isEditing = Boolean(existingReview);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || comment.trim().length < 5) {
      setError(
        "Please write at least 5 characters sharing your workspace experience.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isEditing && existingReview) {
        await api.reviews.update(existingReview.id, {
          rating,
          title: title.trim() || undefined,
          comment: comment.trim(),
        });
      } else {
        await api.reviews.create({
          bookingId: booking.id,
          rating,
          title: title.trim() || undefined,
          comment: comment.trim(),
        });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to submit review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const currentDisplayRating = hoverRating || rating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200/60 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>Verified Stay</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Ref: {booking.reference}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              {isEditing
                ? "Edit Your Review"
                : "Rate Your Workspace Experience"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {booking.resourceName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="my-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          {/* Main Star Picker */}
          <div className="text-center py-2 bg-[#faf9ff] rounded-2xl border border-[#ebe7f5] p-4">
            <span className="text-xs font-bold text-slate-600 block mb-2">
              Overall Workspace Satisfaction
            </span>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1.5 focus:outline-hidden transition-transform hover:scale-115 active:scale-95"
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      star <= currentDisplayRating
                        ? "fill-amber-400 text-amber-400 drop-shadow-xs"
                        : "text-slate-300"
                    }`}
                  />
                </button>
              ))}
            </div>
            <span className="text-xs font-semibold text-slate-900 mt-2 block">
              {RATING_LABELS[currentDisplayRating]}
            </span>
          </div>

          {/* Headline */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Review Title (Optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Peaceful environment with high-speed fiber internet"
              maxLength={120}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-hidden focus:border-[#23055c] focus:ring-1 focus:ring-[#23055c]"
            />
          </div>

          {/* Comment */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                Your Comments &amp; Recommendations{" "}
                <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-slate-400">
                {comment.length} / 2000
              </span>
            </div>
            <textarea
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share what you liked most about working at DAIH, the ambiance, equipment, or areas for improvement..."
              maxLength={2000}
              required
              className="w-full text-xs p-3.5 rounded-xl border border-slate-200 focus:outline-hidden focus:border-[#23055c] focus:ring-1 focus:ring-[#23055c] resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isEditing ? "Save Changes" : "Post Review"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
