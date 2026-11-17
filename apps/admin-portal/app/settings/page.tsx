"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button, Input, Card } from "@daih/ui";
import {
  Settings,
  Clock,
  CreditCard,
  Bell,
  Shield,
  Save,
  CheckCircle2,
  ExternalLink,
  Users,
  Sliders,
  Sparkles,
  Mail,
  Headphones,
  ArrowRight,
  Wallet,
} from "lucide-react";

export default function WorkspaceSettingsPage() {
  const [isSaved, setIsSaved] = useState(false);
  const [settings, setSettings] = useState({
    hubName: "Dare Adeboye Innovation Hub (DAIH)",
    hubEmail: "info@daih.ng",
    hubPhone: "+234 800 324 4482",
    openingHour: "08:00",
    closingHour: "20:00",
    weekendOpeningHour: "09:00",
    weekendClosingHour: "18:00",
    holdExpirationMinutes: 10,
    checkInGracePeriodMinutes: 15,
    paystackMode: "sandbox",
    currency: "NGN (₦)",
    enableEmailReceipts: true,
    enableSmsAlerts: true,
    lowCapacityAlertThreshold: 10,
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-8 max-w-5xl pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-[#23055c] px-2.5 py-0.5 rounded-full">
              System Configuration
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Hub Policies & Preferences
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Settings className="w-8 h-8 text-[#23055c]" />
            Workspace & System Settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Configure operational policies, booking expiration windows, payment
            credentials, and system notifications.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <Link
            href="/settings/support"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#EBE7F5] hover:bg-purple-50 text-slate-700 hover:text-[#23055c] text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Headphones className="w-4 h-4 text-[#23055c]" />
            Support &amp; FAQs
          </Link>
          <Link
            href="/settings/policies"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#EBE7F5] hover:bg-purple-50 text-slate-700 hover:text-[#23055c] text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Shield className="w-4 h-4 text-[#23055c]" />
            Terms & Privacy Policies
          </Link>
          <Link
            href="/settings/email-templates"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#EBE7F5] hover:bg-purple-50 text-slate-700 hover:text-[#23055c] text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Mail className="w-4 h-4 text-[#23055c]" />
            Email Templates
          </Link>
          <Link
            href="/settings/payments"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#EBE7F5] hover:bg-purple-50 text-slate-700 hover:text-[#23055c] text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Wallet className="w-4 h-4 text-[#23055c]" />
            Payment Methods
          </Link>
          <Link
            href="/staff"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#EBE7F5] hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Users className="w-4 h-4 text-[#23055c]" />
            Manage Staff & Roles
          </Link>
        </div>
      </div>

      {/* Quick Access Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Link
          href="/settings/support"
          className="group bg-gradient-to-br from-white to-purple-50/40 p-5 rounded-2xl border border-[#EBE7F5] hover:border-purple-300 hover:shadow-md transition-all flex items-start justify-between gap-4"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-100/70 text-[#23055c] flex items-center justify-center">
                <Headphones className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-900 group-hover:text-[#23055c] transition-colors">
                Customer Support &amp; FAQs
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Configure official phone, WhatsApp, email, hub operating hours,
              and maintain the self-service FAQ knowledge base.
            </p>
          </div>
          <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 group-hover:border-purple-300 group-hover:bg-[#23055c] group-hover:text-white flex items-center justify-center text-slate-400 shrink-0 transition-all mt-1">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          href="/settings/policies"
          className="group bg-gradient-to-br from-white to-purple-50/40 p-5 rounded-2xl border border-[#EBE7F5] hover:border-purple-300 hover:shadow-md transition-all flex items-start justify-between gap-4"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-100/70 text-[#23055c] flex items-center justify-center">
                <Shield className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-900 group-hover:text-[#23055c] transition-colors">
                Terms &amp; Privacy Policies
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Visual rich-text editor for official hub contracts, Terms of
              Service, and NDPR / NDPA 2023 compliance documents.
            </p>
          </div>
          <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 group-hover:border-purple-300 group-hover:bg-[#23055c] group-hover:text-white flex items-center justify-center text-slate-400 shrink-0 transition-all mt-1">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          href="/settings/payments"
          className="group md:col-span-2 xl:col-span-1 bg-gradient-to-br from-white to-purple-50/40 p-5 rounded-2xl border border-[#EBE7F5] hover:border-purple-300 hover:shadow-md transition-all flex items-start justify-between gap-4"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-100/70 text-[#23055c] flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-900 group-hover:text-[#23055c] transition-colors">
                Payment Methods
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Turn Paystack, bank transfer and pay-at-reception on or off, set
              the hub&apos;s bank account for transfers, and how long unpaid
              bookings are held.
            </p>
          </div>
          <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 group-hover:border-purple-300 group-hover:bg-[#23055c] group-hover:text-white flex items-center justify-center text-slate-400 shrink-0 transition-all mt-1">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </Link>
      </div>

      {isSaved && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-2.5 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-xs font-bold">
            Settings saved successfully! Configuration changes are live.
          </span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. Hub General Profile */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#EBE7F5] shadow-xs space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <Sliders className="w-5 h-5 text-[#23055c]" />
            <h2 className="font-bold text-sm text-slate-900">
              Hub Identity & Contact Info
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Workspace Name"
              value={settings.hubName}
              onChange={(e) =>
                setSettings({ ...settings, hubName: e.target.value })
              }
            />
            <Input
              label="Official Contact Email"
              type="email"
              value={settings.hubEmail}
              onChange={(e) =>
                setSettings({ ...settings, hubEmail: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Official Phone"
              value={settings.hubPhone}
              onChange={(e) =>
                setSettings({ ...settings, hubPhone: e.target.value })
              }
            />
            <Input
              label="Operating Currency"
              value={settings.currency}
              disabled
            />
          </div>
        </div>

        {/* 2. Operational Hours & Booking Rules */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#EBE7F5] shadow-xs space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <Clock className="w-5 h-5 text-[#23055c]" />
            <h2 className="font-bold text-sm text-slate-900">
              Operational Hours & Booking Windows
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Input
              label="Weekday Opening"
              type="time"
              value={settings.openingHour}
              onChange={(e) =>
                setSettings({ ...settings, openingHour: e.target.value })
              }
            />
            <Input
              label="Weekday Closing"
              type="time"
              value={settings.closingHour}
              onChange={(e) =>
                setSettings({ ...settings, closingHour: e.target.value })
              }
            />
            <Input
              label="Weekend Opening"
              type="time"
              value={settings.weekendOpeningHour}
              onChange={(e) =>
                setSettings({ ...settings, weekendOpeningHour: e.target.value })
              }
            />
            <Input
              label="Weekend Closing"
              type="time"
              value={settings.weekendClosingHour}
              onChange={(e) =>
                setSettings({ ...settings, weekendClosingHour: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Temporary Hold Auto-Expiration
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="30"
                  value={settings.holdExpirationMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      holdExpirationMinutes: parseInt(e.target.value) || 10,
                    })
                  }
                  className="w-24 h-11 px-3.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#23055c] font-bold"
                />
                <span className="text-xs text-slate-500 font-medium">
                  minutes (releases unpaid desk locks)
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Check-in Grace Period
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="60"
                  value={settings.checkInGracePeriodMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      checkInGracePeriodMinutes: parseInt(e.target.value) || 15,
                    })
                  }
                  className="w-24 h-11 px-3.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#23055c] font-bold"
                />
                <span className="text-xs text-slate-500 font-medium">
                  minutes (before automated hold release)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Payment Gateway & Webhook Settings */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#EBE7F5] shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <CreditCard className="w-5 h-5 text-[#23055c]" />
              <h2 className="font-bold text-sm text-slate-900">
                Paystack Gateway Configuration
              </h2>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
              Connected
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Active Environment Mode
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="paystackMode"
                    value="sandbox"
                    checked={settings.paystackMode === "sandbox"}
                    onChange={() =>
                      setSettings({ ...settings, paystackMode: "sandbox" })
                    }
                    className="text-[#23055c]"
                  />
                  <span>Sandbox Test Mode</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="paystackMode"
                    value="live"
                    checked={settings.paystackMode === "live"}
                    onChange={() =>
                      setSettings({ ...settings, paystackMode: "live" })
                    }
                    className="text-[#23055c]"
                  />
                  <span>Production Live Mode</span>
                </label>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-600 font-mono flex items-center justify-between">
              <div>
                <span className="text-slate-400 font-sans block text-[10px] uppercase font-bold">
                  Webhook Handler URL:
                </span>
                <span>https://api.daih.ng/api/v1/payments/webhook</span>
              </div>
              <span className="text-emerald-600 font-bold text-[10px] uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Active & Listening
              </span>
            </div>
          </div>
        </div>

        {/* 4. Notification & Threshold Alerts */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#EBE7F5] shadow-xs space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <Bell className="w-5 h-5 text-[#23055c]" />
            <h2 className="font-bold text-sm text-slate-900">
              Alerts & System Notifications
            </h2>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableEmailReceipts}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    enableEmailReceipts: e.target.checked,
                  })
                }
                className="rounded text-[#23055c] w-4 h-4"
              />
              <div>
                <span className="text-xs font-bold text-slate-800 block">
                  Automated Email Receipts
                </span>
                <span className="text-[11px] text-slate-500">
                  Send instant PDF receipt to members on verified Paystack
                  transactions.
                </span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableSmsAlerts}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    enableSmsAlerts: e.target.checked,
                  })
                }
                className="rounded text-[#23055c] w-4 h-4"
              />
              <div>
                <span className="text-xs font-bold text-slate-800 block">
                  Critical System & Low Capacity SMS Alerts
                </span>
                <span className="text-[11px] text-slate-500">
                  Notify Operations Admin when desk pool occupancy crosses 90%.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Save CTA */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="primary"
            className="bg-[#23055c] hover:bg-[#392271] text-white px-8 py-3 rounded-xl font-bold text-xs shadow-md cursor-pointer flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save Configuration Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
