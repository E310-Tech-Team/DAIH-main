import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@daih/ui";

export type InlineAlertTone = "error" | "warning" | "info" | "success";

interface InlineAlertProps {
  tone: InlineAlertTone;
  title?: string;
  /** "alert" for errors that appear after an action; "status" for results. Omit for static notes. */
  role?: "alert" | "status";
  className?: string;
  children: React.ReactNode;
}

const TONE_STYLES: Record<
  InlineAlertTone,
  { box: string; icon: string; Icon: typeof Info }
> = {
  error: {
    box: "border-rose-200 bg-rose-50 text-rose-900",
    icon: "text-rose-600",
    Icon: AlertCircle,
  },
  warning: {
    box: "border-amber-300 bg-amber-50 text-amber-950",
    icon: "text-amber-700",
    Icon: AlertTriangle,
  },
  info: {
    box: "border-purple-200 bg-purple-50 text-[#23055c]",
    icon: "text-[#23055c]",
    Icon: Info,
  },
  success: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: "text-emerald-700",
    Icon: CheckCircle2,
  },
};

/** A message shown in place, next to what it is about (instead of a toast or alert()). */
export function InlineAlert({
  tone,
  title,
  role,
  className,
  children,
}: InlineAlertProps) {
  const { box, icon, Icon } = TONE_STYLES[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3.5 text-sm",
        box,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 h-4 w-4 shrink-0", icon)}
      />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-bold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
