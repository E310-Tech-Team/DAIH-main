"use client";

import React from "react";
import Link from "next/link";
import {
  WifiOff,
  RefreshCw,
  ArrowLeft,
  ShieldCheck,
  Phone,
} from "lucide-react";

import { useContactSettings } from "../../hooks/useContactSettings";

export default function OfflinePage() {
  const { contact } = useContactSettings();

  const handleRetry = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f9ff] text-[#181c20] flex flex-col justify-between p-4 sm:p-8">
      {/* Top Bar */}
      <header className="max-w-xl w-full mx-auto flex items-center justify-between py-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 hover:text-[#23055c] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Hub</span>
        </Link>
        <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-200">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline Mode</span>
        </div>
      </header>

      {/* Center Message */}
      <main className="max-w-md w-full mx-auto text-center bg-white border border-slate-200 rounded-3xl p-8 sm:p-10 shadow-xs space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <WifiOff className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Connection Lost
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
            It looks like you are currently offline. Check your network
            connection and try again.
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="w-full py-3 px-4 rounded-xl bg-[#23055c] hover:bg-[#34117c] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Retry Connection</span>
          </button>

          <Link
            href="/dashboard"
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all text-center"
          >
            Try Dashboard
          </Link>
        </div>

        <div className="border-t border-slate-100 pt-5 text-xs text-slate-600 space-y-2">
          {contact?.phone ? (
            <a
              href={`tel:${contact.phone.replace(/\s+/g, "")}`}
              className="flex items-center justify-center gap-1.5 text-slate-800 font-semibold hover:text-[#23055c] transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-[#23055c]" />
              <span>Front Desk: {contact.phone}</span>
            </a>
          ) : (
            <div className="flex items-center justify-center gap-1.5 text-slate-800 font-semibold">
              <Phone className="w-3.5 h-3.5 text-[#23055c]" />
              <span>Hub Front Desk Reception</span>
            </div>
          )}
          <p className="text-[11px] text-slate-600 font-medium">
            If you are on site at DAIH Hub, please verify with reception or
            check your network connection.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-slate-600 font-medium">
        DAIH Workspace &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
