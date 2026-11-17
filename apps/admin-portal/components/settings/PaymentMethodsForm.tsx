"use client";

import React, { useId, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Clock,
  Loader2,
  RotateCcw,
  Save,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn, useToast } from "@daih/ui";
import { api } from "@daih/api-client";
import type { PaymentSettingsDTO } from "@daih/types";
import { FormField, INPUT_CLASS } from "../common/FormField";
import { InlineAlert } from "../common/InlineAlert";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../common/buttonStyles";
import { PaymentOptionSwitch } from "./PaymentOptionSwitch";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatLagosDateTime } from "../../lib/formatters";
import {
  BANK_TEXT_MAX_LENGTH,
  RECEPTION_GRACE_MINUTES,
  TRANSFER_WINDOW_HOURS,
  changedSettings,
  changesBankDetails,
  toDraft,
  validateDraft,
  withoutError,
  type DraftErrors,
  type DraftField,
  type PaymentSettingsDraft,
} from "../../lib/payment-settings-form";

const FIELD_IDS: Readonly<Record<DraftField, string>> = {
  paystackEnabled: "payment-paystack-enabled",
  bankTransferEnabled: "payment-bank-transfer-enabled",
  payAtReceptionEnabled: "payment-reception-enabled",
  bankName: "payment-bank-name",
  bankAccountNumber: "payment-account-number",
  bankAccountName: "payment-account-name",
  transferWindowHours: "payment-transfer-window",
  receptionGraceMinutes: "payment-reception-grace",
};

/** Order in which invalid fields receive focus. */
const FIELD_ORDER: readonly DraftField[] = [
  "bankName",
  "bankAccountNumber",
  "bankAccountName",
  "transferWindowHours",
  "receptionGraceMinutes",
];

/** Spaces and dashes are formatting people paste in; the number itself must be 10 digits. */
function cleanAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, "");
}

interface PaymentMethodsFormProps {
  saved: PaymentSettingsDTO;
  /** Only super admins may change payment settings; everyone else sees them read-only. */
  canEdit: boolean;
  onSaved: (settings: PaymentSettingsDTO) => void;
}

export function PaymentMethodsForm({
  saved,
  canEdit,
  onSaved,
}: PaymentMethodsFormProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<PaymentSettingsDraft>(() =>
    toDraft(saved),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const changes = changedSettings(saved, draft);
  const isDirty = Object.keys(changes).length > 0;
  const isReadOnly = !canEdit || isSaving;

  const updateField = <K extends DraftField>(
    field: K,
    value: PaymentSettingsDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => withoutError(current, field));
    setSaveError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || isSaving || !isDirty) return;

    const problems = validateDraft(draft);
    const firstInvalid = FIELD_ORDER.find((field) => problems[field]);
    if (firstInvalid) {
      setErrors(problems);
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const next = await api.payments.updateSettings(changes);
      setDraft(toDraft(next));
      onSaved(next);
      toast.success(
        changesBankDetails(changes)
          ? "Saved. Super admins and finance officers are emailed whenever the bank details change."
          : "Payment methods saved.",
        { title: "Payment methods updated" },
      );
    } catch (err: unknown) {
      setSaveError(
        apiErrorMessage(err, "Could not save payment methods. Try again."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(toDraft(saved));
    setErrors({});
    setSaveError(null);
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-6">
      <SettingsCard
        icon={Wallet}
        title="Checkout options"
        description="What members can choose when they pay for a booking."
      >
        <div className="divide-y divide-slate-100">
          <PaymentOptionSwitch
            id={FIELD_IDS.paystackEnabled}
            label="Paystack"
            description="Members pay online through Paystack and the booking is confirmed straight away."
            isOn={draft.paystackEnabled}
            isDisabled={isReadOnly}
            onChange={(isOn) => updateField("paystackEnabled", isOn)}
          >
            {!saved.paystackConfigured && (
              <span className="mt-1 inline-flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                No Paystack key on the server — online payments are off until it
                is set
              </span>
            )}
          </PaymentOptionSwitch>
          <PaymentOptionSwitch
            id={FIELD_IDS.bankTransferEnabled}
            label="Bank transfer"
            description="Members transfer to the account below. Finance confirms each payment on Bank transfers before the booking is confirmed."
            isOn={draft.bankTransferEnabled}
            isDisabled={isReadOnly}
            onChange={(isOn) => updateField("bankTransferEnabled", isOn)}
          />
          <PaymentOptionSwitch
            id={FIELD_IDS.payAtReceptionEnabled}
            label="Pay at reception"
            description="Members reserve now and pay cash or POS at the front desk, where reception records the payment."
            isOn={draft.payAtReceptionEnabled}
            isDisabled={isReadOnly}
            onChange={(isOn) => updateField("payAtReceptionEnabled", isOn)}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Banknote}
        title="Bank account for transfers"
        description="Shown to members who choose to pay by bank transfer."
      >
        <InlineAlert tone="info">
          Changing these emails every super admin and finance officer.
        </InlineAlert>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            id={FIELD_IDS.bankName}
            label="Bank name"
            error={errors.bankName}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                autoComplete="off"
                maxLength={BANK_TEXT_MAX_LENGTH}
                value={draft.bankName}
                onChange={(event) =>
                  updateField("bankName", event.target.value)
                }
                disabled={isReadOnly}
                className={INPUT_CLASS}
              />
            )}
          </FormField>
          <FormField
            id={FIELD_IDS.bankAccountNumber}
            label="Account number"
            hint="10 digits (NUBAN)."
            error={errors.bankAccountNumber}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{10}"
                value={draft.bankAccountNumber}
                onChange={(event) =>
                  updateField(
                    "bankAccountNumber",
                    cleanAccountNumber(event.target.value),
                  )
                }
                disabled={isReadOnly}
                className={cn(INPUT_CLASS, "font-mono tracking-wider")}
              />
            )}
          </FormField>
          <FormField
            id={FIELD_IDS.bankAccountName}
            label="Account name"
            error={errors.bankAccountName}
            className="md:col-span-2"
          >
            {(control) => (
              <input
                {...control}
                type="text"
                autoComplete="off"
                maxLength={BANK_TEXT_MAX_LENGTH}
                value={draft.bankAccountName}
                onChange={(event) =>
                  updateField("bankAccountName", event.target.value)
                }
                disabled={isReadOnly}
                className={INPUT_CLASS}
              />
            )}
          </FormField>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Clock}
        title="Holding times"
        description="How long an unpaid booking keeps its space."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            id={FIELD_IDS.transferWindowHours}
            label="Transfer window (hours)"
            hint={`How long a bank-transfer booking is held while the money arrives, never past its start (${TRANSFER_WINDOW_HOURS.min}–${TRANSFER_WINDOW_HOURS.max}).`}
            error={errors.transferWindowHours}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={draft.transferWindowHours}
                onChange={(event) =>
                  updateField("transferWindowHours", event.target.value)
                }
                disabled={isReadOnly}
                className={cn(INPUT_CLASS, "max-w-[10rem]")}
              />
            )}
          </FormField>
          <FormField
            id={FIELD_IDS.receptionGraceMinutes}
            label="Reception grace period (minutes)"
            hint={`How long after a booking starts it stays reserved for a member paying at the desk (${RECEPTION_GRACE_MINUTES.min}–${RECEPTION_GRACE_MINUTES.max}).`}
            error={errors.receptionGraceMinutes}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={draft.receptionGraceMinutes}
                onChange={(event) =>
                  updateField("receptionGraceMinutes", event.target.value)
                }
                disabled={isReadOnly}
                className={cn(INPUT_CLASS, "max-w-[10rem]")}
              />
            )}
          </FormField>
        </div>
      </SettingsCard>

      {saveError && (
        <InlineAlert tone="error" role="alert" title="Not saved">
          {saveError}
        </InlineAlert>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-[#EBE7F5] bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-600">
          Last saved {formatLagosDateTime(saved.updatedAt)} (Lagos time)
        </p>
        {canEdit && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {isDirty && (
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isSaving}
                className={SECONDARY_BUTTON}
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Discard changes
              </button>
            )}
            <button
              type="submit"
              disabled={!isDirty || isSaving}
              className={PRIMARY_BUTTON}
            >
              {isSaving ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Save aria-hidden="true" className="h-4 w-4" />
              )}
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

interface SettingsCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: SettingsCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-xl border border-[#EBE7F5] bg-white p-5 shadow-xs sm:p-6"
    >
      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-[#23055c]">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </div>
        <div>
          <h2 id={headingId} className="text-sm font-bold text-slate-900">
            {title}
          </h2>
          <p className="text-sm text-slate-600">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
