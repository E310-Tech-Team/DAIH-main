import React from "react";

/** Text inputs: 44px tall, visible focus ring, red border when aria-invalid. */
export const INPUT_CLASS =
  "block w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:outline-none focus-visible:border-[#23055c] focus-visible:ring-2 focus-visible:ring-[#23055c] aria-[invalid=true]:border-rose-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600";

export const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[96px] resize-y`;

/** Wiring a control needs so its label, hint and error are announced together. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FormFieldProps {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  /** Ids of other elements that describe the control, e.g. a warning shown below it. */
  describedBy?: string;
  className?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}

/** A labelled control with an optional hint and error, linked by id for assistive tech. */
export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  optional = false,
  describedBy: extraDescribedBy,
  className,
  children,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId, extraDescribedBy]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-semibold text-slate-800"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="text-rose-700">
            {" "}
            *
          </span>
        )}
        {optional && (
          <span className="font-medium text-slate-600"> (optional)</span>
        )}
      </label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
