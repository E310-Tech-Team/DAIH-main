import {
  IEmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from "./email.interface.js";
import { ResendEmailProvider } from "./providers/resend.provider.js";
import { ZeptoMailEmailProvider } from "./providers/zeptomail.provider.js";
import { MockEmailProvider } from "./providers/mock.provider.js";
import { emailTemplateService } from "./email-template.service.js";
import { config } from "../../config/env.js";
import { sanitizeString as escapeHtml } from "../../middleware/validate.middleware.js";

/** Bank account members are told to transfer to, as shown in a change alert. */
export interface BankAccountSnapshot {
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
}

export class EmailService {
  private primaryProvider: IEmailProvider;
  private fallbackProvider: IEmailProvider;
  private mockProvider: MockEmailProvider;

  constructor() {
    this.primaryProvider = new ResendEmailProvider();
    this.fallbackProvider = new ZeptoMailEmailProvider();
    this.mockProvider = new MockEmailProvider();
  }

  /**
   * Sends email with primary (Resend) -> fallback (ZeptoMail) failover logic.
   * If both fail or in test/dev with no keys, routes to MockProvider safely.
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    // If explicitly set to mock or running in test without keys, use Mock Provider
    if (
      config.email.provider === "mock" ||
      (!config.email.resendApiKey && !config.email.zeptomailApiKey)
    ) {
      return this.mockProvider.sendEmail(options);
    }

    // 1. Attempt Primary (Resend)
    if (config.email.resendApiKey && config.email.provider !== "zeptomail") {
      const primaryResult = await this.primaryProvider.sendEmail(options);
      if (primaryResult.success) {
        return primaryResult;
      }
      console.warn(
        `⚠️ Primary email provider (Resend) failed: ${primaryResult.error}. Attempting ZeptoMail fallback...`,
      );
    }

    // 2. Attempt Fallback (ZeptoMail)
    if (config.email.zeptomailApiKey) {
      const fallbackResult = await this.fallbackProvider.sendEmail(options);
      if (fallbackResult.success) {
        return fallbackResult;
      }
      console.error(
        `❌ Fallback email provider (ZeptoMail) failed: ${fallbackResult.error}`,
      );
    }

    // 3. If in non-production, fallback to mock so flows don't crash
    if (config.env !== "production") {
      console.warn(
        "⚠️ Both live email providers failed or were unconfigured; falling back to Mock provider in development",
      );
      return this.mockProvider.sendEmail(options);
    }

    return {
      success: false,
      provider: "none",
      error: "All email providers failed to deliver message",
    };
  }

  /**
   * Sends Verification Email with branded HTML link
   */
  async sendVerificationEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<SendEmailResult> {
    const verifyUrl = `${config.frontendUrls.customer}/verify-email?token=${encodeURIComponent(rawToken)}`;

    const rendered = await emailTemplateService.renderTemplate("verification", {
      name,
      verifyUrl,
      expiresInHours: config.jwt.verificationExpiresInHours,
    });

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Password Reset Email
   */
  async sendPasswordResetEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<SendEmailResult> {
    const resetUrl = `${config.frontendUrls.customer}/reset-password?token=${encodeURIComponent(rawToken)}`;

    const rendered = await emailTemplateService.renderTemplate(
      "password_reset",
      {
        name,
        resetUrl,
        expiresInHours: config.jwt.passwordResetExpiresInHours,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Staff / Admin Account Setup Invitation with 1-hour one-time link
   */
  async sendStaffWelcomeEmail(
    to: string,
    name: string,
    role: string,
    setupUrl: string,
  ): Promise<SendEmailResult> {
    const rendered = await emailTemplateService.renderTemplate(
      "staff_welcome",
      {
        name,
        role,
        setupUrl,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Security Alert when a 3rd-party provider (e.g. Google) is linked to an existing account
   */
  async sendAccountLinkedEmail(
    to: string,
    name: string,
    provider: string = "Google",
  ): Promise<SendEmailResult> {
    const resetUrl = `${config.frontendUrls.customer}/forgot-password`;
    const subject = `Security Alert: Your DAIH account was linked to ${provider}`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px;">
        <h2 style="color: #23055c; margin-bottom: 16px;">Security Alert</h2>
        <p>Hello ${name},</p>
        <p>Your DAIH account (<strong>${to}</strong>) was just connected to <strong>${provider} Sign-In</strong>.</p>
        <p style="margin-top: 16px;">You can now sign in using either your existing password or ${provider}.</p>
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
          <p style="margin: 0; color: #991b1b; font-weight: 600;">Did you not make this change?</p>
          <p style="margin: 8px 0 0 0; color: #7f1d1d; font-size: 14px;">
            If you did not link your ${provider} account, please immediately 
            <a href="${resetUrl}" style="color: #b91c1c; text-decoration: underline; font-weight: 600;">reset your password</a>
            and contact support at support@daih.ng.
          </p>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 32px;">
          Best regards,<br>The DAIH Security Team
        </p>
      </div>
    `;
    const text = `Hello ${name},\n\nYour DAIH account (${to}) was just connected to ${provider} Sign-In.\n\nIf you did not make this change, please reset your password immediately at ${resetUrl} and contact support.\n\nBest regards,\nThe DAIH Security Team`;

    return this.sendEmail({
      to,
      subject,
      html,
      text,
    });
  }

  /**
   * Security alert to finance and super admins when the bank account members
   * transfer to is changed. Values are staff-typed, so every one is escaped.
   */
  async sendPaymentAccountChangedEmail(
    to: string,
    name: string,
    change: {
      changedBy: string;
      changedAt: Date;
      before: BankAccountSnapshot;
      after: BankAccountSnapshot;
    },
  ): Promise<SendEmailResult> {
    const settingsUrl = `${config.frontendUrls.admin}/settings/payments`;
    const describe = (account: BankAccountSnapshot): string =>
      [account.bankName, account.accountNumber, account.accountName]
        .map((part) => part || "—")
        .join(" · ");
    const when = change.changedAt.toISOString();
    const subject =
      "Security alert: the DAIH bank account for transfers was changed";
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px;">
        <h2 style="color: #23055c; margin-bottom: 16px;">Bank account changed</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>The bank account members are told to pay into was changed by <strong>${escapeHtml(change.changedBy)}</strong> at ${escapeHtml(when)} (UTC).</p>
        <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Before</td><td style="padding: 4px 0;">${escapeHtml(describe(change.before))}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">After</td><td style="padding: 4px 0;"><strong>${escapeHtml(describe(change.after))}</strong></td></tr>
        </table>
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
          <p style="margin: 0; color: #991b1b; font-weight: 600;">Not expected?</p>
          <p style="margin: 8px 0 0 0; color: #7f1d1d; font-size: 14px;">
            Changing the payout account is a common fraud. If nobody agreed this change,
            <a href="${settingsUrl}" style="color: #b91c1c; text-decoration: underline; font-weight: 600;">restore the correct account</a>
            and turn off bank transfer until it is resolved.
          </p>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 32px;">The DAIH Security Team</p>
      </div>
    `;
    const text = `Hello ${name},\n\nThe bank account members are told to pay into was changed by ${change.changedBy} at ${when} (UTC).\n\nBefore: ${describe(change.before)}\nAfter: ${describe(change.after)}\n\nChanging the payout account is a common fraud. If nobody agreed this change, restore the correct account at ${settingsUrl} and turn off bank transfer until it is resolved.\n\nThe DAIH Security Team`;

    return this.sendEmail({ to, subject, html, text });
  }

  /**
   * Sends Payment Receipt & Booking Confirmation Email
   */
  async sendPaymentReceiptEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    amount: number,
    currency: string = "NGN",
    invoiceNumber?: string,
  ): Promise<SendEmailResult> {
    const dashboardUrl = `${config.frontendUrls.customer}/bookings`;
    const formattedAmount = `${currency} ${amount.toLocaleString()}`;

    const rendered = await emailTemplateService.renderTemplate(
      "payment_receipt",
      {
        customerName,
        bookingReference,
        resourceName,
        formattedAmount,
        invoiceNumber,
        dashboardUrl,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Booking Confirmation with Access Pass Link
   */
  async sendBookingConfirmationEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    startTime: string,
    endTime: string,
    qrToken?: string,
  ): Promise<SendEmailResult> {
    const passUrl = `${config.frontendUrls.customer}/qr`;
    const formattedStart = new Date(startTime).toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const formattedEnd = new Date(endTime).toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const rendered = await emailTemplateService.renderTemplate(
      "booking_confirmation",
      {
        customerName,
        bookingReference,
        resourceName,
        formattedStart,
        formattedEnd,
        passUrl,
        qrToken,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Booking Rescheduled Notification
   */
  async sendBookingRescheduledEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    startTime: string,
    endTime: string,
    qrToken?: string,
  ): Promise<SendEmailResult> {
    const passUrl = `${config.frontendUrls.customer}/qr`;
    const formattedStart = new Date(startTime).toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const formattedEnd = new Date(endTime).toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const rendered = await emailTemplateService.renderTemplate(
      "booking_rescheduled",
      {
        customerName,
        bookingReference,
        resourceName,
        formattedStart,
        formattedEnd,
        passUrl,
        qrToken,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Check-In Welcome Notice with Wi-Fi Credentials
   */
  async sendCheckInWelcomeEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    wifiCredentials?: {
      ssid?: string;
      username?: string;
      pin?: string;
      networkName?: string;
      password?: string;
      validUntil?: string;
    },
    endTime?: string,
  ): Promise<SendEmailResult> {
    const formattedEnd = endTime
      ? new Date(endTime).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "End of booked window";

    const wifiSsid =
      wifiCredentials?.ssid ||
      wifiCredentials?.networkName ||
      "DAIH-Member-HighSpeed";
    const wifiUsername = wifiCredentials?.username || "Guest";
    const wifiPin = wifiCredentials?.pin || wifiCredentials?.password || "N/A";

    const rendered = await emailTemplateService.renderTemplate(
      "check_in_welcome",
      {
        customerName,
        bookingReference,
        resourceName,
        wifiSsid,
        wifiUsername,
        wifiPin,
        formattedEnd,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Check-Out Departure Summary
   */
  async sendCheckOutSummaryEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    departureTime: string,
    bookingId?: string,
  ): Promise<SendEmailResult> {
    const formattedDeparture = new Date(departureTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const reviewUrl = bookingId
      ? `${config.frontendUrls.customer}/bookings?reviewBookingId=${bookingId}`
      : `${config.frontendUrls.customer}/bookings`;

    const rendered = await emailTemplateService.renderTemplate(
      "check_out_summary",
      {
        customerName,
        bookingReference,
        resourceName,
        formattedDeparture,
        reviewUrl,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends "How was your session? Leave a Review" email upon booking completion
   */
  async sendBookingCompletedReviewEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    bookingId: string,
  ): Promise<SendEmailResult> {
    const reviewUrl = `${config.frontendUrls.customer}/bookings?reviewBookingId=${bookingId}`;

    const rendered = await emailTemplateService.renderTemplate(
      "booking_completed_review",
      {
        customerName,
        bookingReference,
        resourceName,
        reviewUrl,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Booking Reminder Email
   */
  async sendBookingReminderEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    startTime: string,
  ): Promise<SendEmailResult> {
    const formattedStart = new Date(startTime).toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const passUrl = `${config.frontendUrls.customer}/qr`;

    const rendered = await emailTemplateService.renderTemplate(
      "booking_reminder",
      {
        customerName,
        bookingReference,
        resourceName,
        formattedStart,
        passUrl,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends Booking Cancellation Notice
   */
  async sendBookingCancelledEmail(
    to: string,
    customerName: string,
    bookingReference: string,
    resourceName: string,
    reason?: string,
  ): Promise<SendEmailResult> {
    const rendered = await emailTemplateService.renderTemplate(
      "booking_cancelled",
      {
        customerName,
        bookingReference,
        resourceName,
        reason,
      },
    );

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends a 6-digit MFA OTP code to a staff user.
   * Template key: "mfa_otp"
   */
  async sendMfaOtpEmail(
    to: string,
    name: string,
    otpCode: string,
  ): Promise<SendEmailResult> {
    const rendered = await emailTemplateService.renderTemplate("mfa_otp", {
      name,
      otpCode,
      expiresInMinutes: "10",
    });

    return this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Sends a Marketing Campaign or Automated Preset broadcast message.
   */
  async sendCampaignBroadcastEmail(
    to: string,
    recipientName: string,
    subject: string,
    content: string,
    coinReward?: number,
    discountPercentage?: number,
  ): Promise<SendEmailResult> {
    const rewardBadge =
      coinReward && coinReward > 0
        ? `<div style="background-color: #f3e8ff; border: 1px solid #d8b4fe; border-radius: 8px; padding: 12px; margin: 16px 0; color: #581c87; font-weight: bold;">🎁 Bonus Reward: <strong>${coinReward} Peedee Coins</strong> credited to your wallet!</div>`
        : "";
    const discountBadge =
      discountPercentage && discountPercentage > 0
        ? `<div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 12px; margin: 16px 0; color: #065f46; font-weight: bold;">🏷️ Special Offer: <strong>${discountPercentage}% OFF</strong> your next booking!</div>`
        : "";

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; line-height: 1.6; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
        <h2 style="color: #23055c; margin-bottom: 12px; font-size: 20px;">${subject}</h2>
        <p style="font-size: 14px; margin-bottom: 16px;">Hello ${recipientName || "Member"},</p>
        <div style="margin: 16px 0; white-space: pre-wrap; font-size: 14px; color: #334155; line-height: 1.6;">${content}</div>
        ${rewardBadge}
        ${discountBadge}
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b;">
          <p style="margin: 0;">Best regards,<br><strong style="color: #23055c;">DAIH Workspaces Team</strong></p>
        </div>
      </div>
    `;

    return this.sendEmail({
      to,
      subject,
      html,
      text: `${content}\n\n${coinReward ? `Bonus Reward: ${coinReward} Peedee Coins\n` : ""}${discountPercentage ? `Special Offer: ${discountPercentage}% OFF\n` : ""}\nBest regards,\nDAIH Workspaces Team`,
    });
  }

  getMockProvider(): MockEmailProvider {
    return this.mockProvider;
  }
}

export const emailService = new EmailService();
