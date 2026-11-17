import { AlertCircle } from "lucide-react";

type AlertTone = "error" | "warning";

const TONE_CLASSES: Readonly<Record<AlertTone, string>> = {
  error: "border-rose-200 bg-rose-50 text-rose-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
};

interface InlineAlertProps {
  message: string;
  id?: string;
  tone?: AlertTone;
  /** "alert" interrupts (errors from the member's own action); "status" waits its turn. */
  role?: "alert" | "status";
}

/** A message shown next to the control it is about, never as a pop-up. */
export function InlineAlert({
  message,
  id,
  tone = "error",
  role = "alert",
}: InlineAlertProps) {
  return (
    <p
      id={id}
      role={role}
      className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-medium ${TONE_CLASSES[tone]}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
