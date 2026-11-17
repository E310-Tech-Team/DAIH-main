import type { PaymentSetting, Prisma } from "@prisma/client";
import {
  AvailablePaymentOption,
  PaymentSettingsDTO,
  UpdatePaymentSettingsInput,
  UserRole,
} from "@daih/types";
import { prisma } from "../../db/client.js";
import { config } from "../../config/env.js";
import { safeLogger } from "../../utils/sanitizer.js";
import { emailService, BankAccountSnapshot } from "../email/email.service.js";
import { isRealPaystackSecretKey } from "./paystack-key.js";
import {
  PaymentSettingsValues,
  resolveAvailableOptions,
  validatePaymentSettings,
} from "./payment-options.js";
import { isUniqueViolation, paymentError } from "./payment-errors.js";

const SETTINGS_ID = "default";

/** Paystack can take payments: a real key in production; mocks are fine elsewhere. */
export function isPaystackConfigured(): boolean {
  return (
    config.env !== "production" ||
    isRealPaystackSecretKey(config.paystack.secretKey)
  );
}

function valuesOf(row: PaymentSetting): PaymentSettingsValues {
  return {
    paystackEnabled: row.paystackEnabled,
    bankTransferEnabled: row.bankTransferEnabled,
    payAtReceptionEnabled: row.payAtReceptionEnabled,
    bankName: row.bankName,
    bankAccountNumber: row.bankAccountNumber,
    bankAccountName: row.bankAccountName,
    transferWindowHours: row.transferWindowHours,
    receptionGraceMinutes: row.receptionGraceMinutes,
  };
}

function toDTO(row: PaymentSetting): PaymentSettingsDTO {
  return {
    ...valuesOf(row),
    paystackConfigured: isPaystackConfigured(),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function snapshotOf(values: PaymentSettingsValues): BankAccountSnapshot {
  return {
    bankName: values.bankName,
    accountNumber: values.bankAccountNumber,
    accountName: values.bankAccountName,
  };
}

function bankAccountChanged(
  before: PaymentSettingsValues,
  after: PaymentSettingsValues,
): boolean {
  return (
    before.bankName !== after.bankName ||
    before.bankAccountNumber !== after.bankAccountNumber ||
    before.bankAccountName !== after.bankAccountName
  );
}

/** Undefined keeps the current value; blank text clears it. */
function nextText(
  input: string | null | undefined,
  current: string | null,
): string | null {
  if (input === undefined) return current;
  const trimmed = (input ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function mergeSettings(
  current: PaymentSettingsValues,
  input: UpdatePaymentSettingsInput,
): PaymentSettingsValues {
  return {
    paystackEnabled: input.paystackEnabled ?? current.paystackEnabled,
    bankTransferEnabled:
      input.bankTransferEnabled ?? current.bankTransferEnabled,
    payAtReceptionEnabled:
      input.payAtReceptionEnabled ?? current.payAtReceptionEnabled,
    bankName: nextText(input.bankName, current.bankName),
    bankAccountNumber: nextText(
      input.bankAccountNumber,
      current.bankAccountNumber,
    ),
    bankAccountName: nextText(input.bankAccountName, current.bankAccountName),
    transferWindowHours:
      input.transferWindowHours ?? current.transferWindowHours,
    receptionGraceMinutes:
      input.receptionGraceMinutes ?? current.receptionGraceMinutes,
  };
}

export class PaymentSettingsService {
  /** Reads the single settings row, creating it with the defaults on first use. */
  private async getRow(): Promise<PaymentSetting> {
    const existing = await prisma.paymentSetting.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (existing) return existing;
    try {
      return await prisma.paymentSetting.create({ data: { id: SETTINGS_ID } });
    } catch (err: unknown) {
      if (!isUniqueViolation(err)) throw err;
      // Another request created it first.
      return prisma.paymentSetting.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
    }
  }

  async getValues(): Promise<PaymentSettingsValues> {
    return valuesOf(await this.getRow());
  }

  async getSettings(): Promise<PaymentSettingsDTO> {
    return toDTO(await this.getRow());
  }

  async getAvailableOptions(): Promise<AvailablePaymentOption[]> {
    return resolveAvailableOptions(
      await this.getValues(),
      isPaystackConfigured(),
    );
  }

  async updateSettings(
    actorUserId: string,
    input: UpdatePaymentSettingsInput,
  ): Promise<PaymentSettingsDTO> {
    const current = valuesOf(await this.getRow());
    const next = mergeSettings(current, input);

    const problems = validatePaymentSettings(next);
    if (problems.length > 0) {
      throw paymentError(400, "INVALID_PAYMENT_SETTINGS", problems.join(" "));
    }

    const accountChanged = bankAccountChanged(current, next);
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.paymentSetting.update({
        where: { id: SETTINGS_ID },
        data: { ...next, updatedBy: actorUserId },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "PAYMENT_SETTINGS_UPDATED",
          entityType: "PaymentSetting",
          entityId: SETTINGS_ID,
          metadata: {
            before: { ...current },
            after: { ...next },
            bankAccountChanged: accountChanged,
          } as Prisma.InputJsonObject,
        },
      });
      return row;
    });

    if (accountChanged) {
      await this.alertBankAccountChange(
        actorUserId,
        current,
        next,
        updated.updatedAt,
      );
    }
    return toDTO(updated);
  }

  /**
   * Emails every active super admin and finance officer. A changed payout
   * account is a classic fraud, so it must never change silently.
   */
  private async alertBankAccountChange(
    actorUserId: string,
    before: PaymentSettingsValues,
    after: PaymentSettingsValues,
    changedAt: Date,
  ): Promise<void> {
    const [actor, recipients] = await Promise.all([
      prisma.user.findUnique({
        where: { id: actorUserId },
        select: { firstName: true, lastName: true, email: true },
      }),
      prisma.user.findMany({
        where: {
          role: { in: [UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER] },
          isVerified: true,
          deactivatedAt: null,
        },
        select: { email: true, firstName: true },
      }),
    ]);
    const changedBy = actor
      ? `${actor.firstName} ${actor.lastName} (${actor.email})`
      : actorUserId;

    const results = await Promise.allSettled(
      recipients.map((recipient) =>
        emailService.sendPaymentAccountChangedEmail(
          recipient.email,
          recipient.firstName || "there",
          {
            changedBy,
            changedAt,
            before: snapshotOf(before),
            after: snapshotOf(after),
          },
        ),
      ),
    );
    const failed = results.filter(
      (r) => r.status === "rejected" || !r.value.success,
    ).length;
    if (failed > 0) {
      safeLogger.error(
        `[PaymentSettings] ${failed} of ${recipients.length} bank-account change alerts could not be sent`,
      );
    }
  }
}

export const paymentSettingsService = new PaymentSettingsService();
