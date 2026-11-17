"use client";

import React, { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@daih/ui";
import { api } from "@daih/api-client";
import type {
  ConfirmBankTransferInput,
  ManualPaymentOutcome,
  PendingBankTransfer,
} from "@daih/types";
import { FormField, INPUT_CLASS, TEXTAREA_CLASS } from "../../common/FormField";
import { InlineAlert } from "../../common/InlineAlert";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../common/buttonStyles";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-errors";
import { formatNaira } from "../../../lib/formatters";
import {
  formatAmountForInput,
  nairaInputProblem,
  parseNairaInput,
  toKobo,
} from "../../../lib/money-input";
import {
  REFERENCE_INPUT_PATTERN,
  REFERENCE_MAX_LENGTH,
  referenceCharacterProblem,
  validateReference,
} from "../../../lib/reference-validation";
import { TransferOutcome } from "./TransferOutcome";
import { TransferSummary } from "./TransferSummary";
import { isBookingNoLongerHeld } from "./transferTabs";

const BANK_REFERENCE_MIN_LENGTH = 4;
const NOTE_MAX_LENGTH = 500;
/** Errors meaning the list behind the modal is out of date, so it is refreshed. */
const STALE_LIST_ERROR_CODES: ReadonlySet<string> = new Set([
  "TRANSFER_ALREADY_SETTLED",
  "TRANSFER_NOT_FOUND",
]);

type ConfirmField = "amount" | "bankReference" | "acknowledgeMismatch";
type ConfirmErrors = Partial<Record<ConfirmField, string>>;
/** Order in which invalid fields receive focus. */
const FIELD_ORDER: readonly ConfirmField[] = [
  "amount",
  "acknowledgeMismatch",
  "bankReference",
];

interface ConfirmTransferModalProps {
  /** The transfer to confirm; the modal is open while this is set. */
  transfer: PendingBankTransfer | null;
  currentUserId?: string;
  onClose: () => void;
  /** The transfer list changed (a transfer was confirmed, or the list is stale). */
  onListChanged: () => void;
}

export function ConfirmTransferModal({
  transfer,
  currentUserId,
  onClose,
  onListChanged,
}: ConfirmTransferModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal
      isOpen={transfer !== null}
      onClose={handleClose}
      title="Confirm transfer received"
    >
      {transfer && (
        <ConfirmTransferForm
          key={transfer.transactionId}
          transfer={transfer}
          isOwnBooking={!!currentUserId && transfer.member.id === currentUserId}
          isSubmitting={isSubmitting}
          onSubmittingChange={setIsSubmitting}
          onClose={handleClose}
          onListChanged={onListChanged}
        />
      )}
    </Modal>
  );
}

interface ConfirmTransferFormProps {
  transfer: PendingBankTransfer;
  isOwnBooking: boolean;
  isSubmitting: boolean;
  onSubmittingChange: (isSubmitting: boolean) => void;
  onClose: () => void;
  onListChanged: () => void;
}

function submitLabelFor(
  isSubmitting: boolean,
  recordsMismatch: boolean,
): string {
  if (isSubmitting) return "Confirming…";
  return recordsMismatch ? "Record for reconciliation" : "Confirm received";
}

function ConfirmTransferForm({
  transfer,
  isOwnBooking,
  isSubmitting,
  onSubmittingChange,
  onClose,
  onListChanged,
}: ConfirmTransferFormProps) {
  const idPrefix = useId();
  const fieldIds: Record<ConfirmField, string> = {
    amount: `${idPrefix}-amount`,
    bankReference: `${idPrefix}-bank-reference`,
    acknowledgeMismatch: `${idPrefix}-acknowledge-mismatch`,
  };
  const noteId = `${idPrefix}-note`;
  const mismatchWarningId = `${idPrefix}-mismatch-warning`;

  const [amountText, setAmountText] = useState(() =>
    formatAmountForInput(transfer.amount),
  );
  const [bankReference, setBankReference] = useState("");
  const [note, setNote] = useState("");
  const [acknowledgeMismatch, setAcknowledgeMismatch] = useState(false);
  const [errors, setErrors] = useState<ConfirmErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ManualPaymentOutcome | null>(null);

  if (outcome) {
    return <TransferOutcome outcome={outcome} onDone={onClose} />;
  }

  const enteredAmount = parseNairaInput(amountText);
  const isMismatch =
    enteredAmount !== null && toKobo(enteredAmount) !== toKobo(transfer.amount);
  const recordsMismatch = isMismatch && acknowledgeMismatch;
  const referenceError =
    errors.bankReference ?? referenceCharacterProblem(bankReference);

  const clearErrors = (fields: readonly ConfirmField[]) => {
    setErrors(
      (current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([field]) => !fields.includes(field as ConfirmField),
          ),
        ) as ConfirmErrors,
    );
    setSubmitError(null);
  };

  const handleAmountChange = (value: string) => {
    setAmountText(value);
    // An acknowledgement covers one specific amount: ask again after any edit.
    setAcknowledgeMismatch(false);
    clearErrors(["amount", "acknowledgeMismatch"]);
  };

  const validate = (): ConfirmErrors => {
    const amountProblem = nairaInputProblem(amountText);
    const referenceProblem = validateReference(bankReference, {
      minLength: BANK_REFERENCE_MIN_LENGTH,
      label: "bank reference",
    });
    const acknowledgementProblem =
      isMismatch && !acknowledgeMismatch
        ? "Tick the box to record a different amount, or correct the amount."
        : null;
    return {
      ...(amountProblem ? { amount: amountProblem } : {}),
      ...(referenceProblem ? { bankReference: referenceProblem } : {}),
      ...(acknowledgementProblem
        ? { acknowledgeMismatch: acknowledgementProblem }
        : {}),
    };
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || isOwnBooking) return;

    const problems = validate();
    const firstInvalid = FIELD_ORDER.find((field) => problems[field]);
    if (firstInvalid || enteredAmount === null) {
      setErrors(problems);
      if (firstInvalid)
        document.getElementById(fieldIds[firstInvalid])?.focus();
      return;
    }

    const trimmedNote = note.trim();
    const input: ConfirmBankTransferInput = {
      amountReceived: enteredAmount,
      bankReference: bankReference.trim(),
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(recordsMismatch ? { allowAmountMismatch: true } : {}),
    };

    onSubmittingChange(true);
    setSubmitError(null);
    try {
      const result = await api.payments.confirmBankTransfer(
        transfer.transactionId,
        input,
      );
      setOutcome(result);
      onListChanged();
    } catch (err: unknown) {
      setSubmitError(
        apiErrorMessage(err, "Could not confirm this transfer. Try again."),
      );
      const code = apiErrorCode(err);
      if (code && STALE_LIST_ERROR_CODES.has(code)) onListChanged();
    } finally {
      onSubmittingChange(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <TransferSummary transfer={transfer} />

      <InlineAlert tone="warning" title="Check the bank, not a message">
        Check the bank statement or banking app. Never confirm from a screenshot
        or SMS alert — fake alerts are common.
      </InlineAlert>

      {isBookingNoLongerHeld(transfer.booking.state) && (
        <InlineAlert tone="warning">
          This booking is no longer held — confirming will re-check
          availability, and a paid duplicate will be refunded.
        </InlineAlert>
      )}

      {isOwnBooking && (
        <InlineAlert tone="error">
          This is your own booking, so another finance officer must confirm it.
        </InlineAlert>
      )}

      <div className="space-y-3">
        <FormField
          id={fieldIds.amount}
          label="Amount received (₦)"
          required
          hint="Exactly as it appears on the bank statement."
          error={errors.amount}
          describedBy={isMismatch ? mismatchWarningId : undefined}
        >
          {(control) => (
            <input
              {...control}
              // The shared Modal does not move focus into the dialog.
              autoFocus
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(event) => handleAmountChange(event.target.value)}
              disabled={isSubmitting}
              className={INPUT_CLASS}
            />
          )}
        </FormField>

        {isMismatch && enteredAmount !== null && (
          <MismatchAcknowledgement
            checkboxId={fieldIds.acknowledgeMismatch}
            warningId={mismatchWarningId}
            enteredAmount={enteredAmount}
            amountDue={transfer.amount}
            isChecked={acknowledgeMismatch}
            error={errors.acknowledgeMismatch}
            isDisabled={isSubmitting}
            onChange={(isChecked) => {
              setAcknowledgeMismatch(isChecked);
              clearErrors(["acknowledgeMismatch"]);
            }}
          />
        )}
      </div>

      <FormField
        id={fieldIds.bankReference}
        label="Bank reference"
        required
        hint="The bank's transaction or session reference for this transfer."
        error={referenceError}
      >
        {(control) => (
          <input
            {...control}
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={REFERENCE_MAX_LENGTH}
            pattern={REFERENCE_INPUT_PATTERN}
            value={bankReference}
            onChange={(event) => {
              setBankReference(event.target.value);
              clearErrors(["bankReference"]);
            }}
            disabled={isSubmitting}
            className={`${INPUT_CLASS} font-mono`}
          />
        )}
      </FormField>

      <FormField
        id={noteId}
        label="Note"
        optional
        hint={`${note.length}/${NOTE_MAX_LENGTH} characters. Kept with the audit record.`}
      >
        {(control) => (
          <textarea
            {...control}
            rows={3}
            maxLength={NOTE_MAX_LENGTH}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={isSubmitting}
            className={TEXTAREA_CLASS}
          />
        )}
      </FormField>

      {submitError && (
        <InlineAlert tone="error" role="alert">
          {submitError}
        </InlineAlert>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting || isOwnBooking}
          className={PRIMARY_BUTTON}
        >
          {isSubmitting && (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          )}
          {submitLabelFor(isSubmitting, recordsMismatch)}
        </button>
      </div>
    </form>
  );
}

interface MismatchAcknowledgementProps {
  checkboxId: string;
  /** Id of the warning text, which also describes the amount input. */
  warningId: string;
  enteredAmount: number;
  amountDue: number;
  isChecked: boolean;
  error?: string;
  isDisabled: boolean;
  onChange: (isChecked: boolean) => void;
}

/** A different amount must be acknowledged before it is sent (`allowAmountMismatch`). */
function MismatchAcknowledgement({
  checkboxId,
  warningId,
  enteredAmount,
  amountDue,
  isChecked,
  error,
  isDisabled,
  onChange,
}: MismatchAcknowledgementProps) {
  const errorId = `${checkboxId}-error`;
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3.5">
      <p id={warningId} className="text-sm font-semibold text-amber-950">
        You entered {formatNaira(enteredAmount)} but {formatNaira(amountDue)} is
        due. Check for a typo.
      </p>
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={isChecked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={isDisabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-400 accent-[#23055c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23055c] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
        />
        <label
          htmlFor={checkboxId}
          className="min-h-[44px] flex-1 cursor-pointer text-sm text-slate-800"
        >
          The member really sent a different amount — record it for
          reconciliation (the booking will not be confirmed).
        </label>
      </div>
      {error && (
        <p id={errorId} className="text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
