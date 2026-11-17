"use client";

import React, { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@daih/ui";
import { api } from "@daih/api-client";
import type { PendingBankTransfer } from "@daih/types";
import { FormField, TEXTAREA_CLASS } from "../../common/FormField";
import { InlineAlert } from "../../common/InlineAlert";
import { DANGER_BUTTON, SECONDARY_BUTTON } from "../../common/buttonStyles";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-errors";
import { TransferSummary } from "./TransferSummary";

/** Mirrors the API: a rejection reason is 5–500 characters. */
const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;
/** Errors meaning the list behind the modal is out of date, so it is refreshed. */
const STALE_LIST_ERROR_CODES: ReadonlySet<string> = new Set([
  "TRANSFER_NOT_PENDING",
  "TRANSFER_NOT_FOUND",
]);

interface RejectTransferModalProps {
  /** The transfer to reject; the modal is open while this is set. */
  transfer: PendingBankTransfer | null;
  onClose: () => void;
  onRejected: (transfer: PendingBankTransfer) => void;
  /** The list behind the modal is out of date. */
  onListChanged: () => void;
}

export function RejectTransferModal({
  transfer,
  onClose,
  onRejected,
  onListChanged,
}: RejectTransferModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal
      isOpen={transfer !== null}
      onClose={handleClose}
      title="Reject transfer"
    >
      {transfer && (
        <RejectTransferForm
          key={transfer.transactionId}
          transfer={transfer}
          isSubmitting={isSubmitting}
          onSubmittingChange={setIsSubmitting}
          onCancel={handleClose}
          onRejected={onRejected}
          onListChanged={onListChanged}
        />
      )}
    </Modal>
  );
}

interface RejectTransferFormProps {
  transfer: PendingBankTransfer;
  isSubmitting: boolean;
  onSubmittingChange: (isSubmitting: boolean) => void;
  onCancel: () => void;
  onRejected: (transfer: PendingBankTransfer) => void;
  onListChanged: () => void;
}

function RejectTransferForm({
  transfer,
  isSubmitting,
  onSubmittingChange,
  onCancel,
  onRejected,
  onListChanged,
}: RejectTransferFormProps) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedReason = reason.trim();
    if (trimmedReason.length < REASON_MIN_LENGTH) {
      setReasonError(
        `Give a reason of at least ${REASON_MIN_LENGTH} characters.`,
      );
      document.getElementById(reasonId)?.focus();
      return;
    }

    onSubmittingChange(true);
    setSubmitError(null);
    try {
      await api.payments.rejectBankTransfer(
        transfer.transactionId,
        trimmedReason,
      );
      onRejected(transfer);
    } catch (err: unknown) {
      setSubmitError(
        apiErrorMessage(err, "Could not reject this transfer. Try again."),
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

      <p className="text-sm text-slate-700">
        Reject a transfer only when no matching payment is on the bank
        statement. It is closed and can no longer be confirmed.
      </p>

      <FormField
        id={reasonId}
        label="Reason"
        required
        hint={`At least ${REASON_MIN_LENGTH} characters (${reason.trim().length}/${REASON_MAX_LENGTH}). For example: no credit for this reference on the statement.`}
        error={reasonError}
      >
        {(control) => (
          <textarea
            {...control}
            // The shared Modal does not move focus into the dialog.
            autoFocus
            rows={4}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(null);
              setSubmitError(null);
            }}
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
          onClick={onCancel}
          disabled={isSubmitting}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting} className={DANGER_BUTTON}>
          {isSubmitting && (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          )}
          {isSubmitting ? "Rejecting…" : "Reject transfer"}
        </button>
      </div>
    </form>
  );
}
