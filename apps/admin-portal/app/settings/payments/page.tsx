"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Wallet } from "lucide-react";
import { cn } from "@daih/ui";
import { api, useAuth } from "@daih/api-client";
import type { PaymentSettingsDTO } from "@daih/types";
import { InlineAlert } from "../../../components/common/InlineAlert";
import { SECONDARY_BUTTON } from "../../../components/common/buttonStyles";
import { PaymentMethodsForm } from "../../../components/settings/PaymentMethodsForm";
import { apiErrorMessage } from "../../../lib/api-errors";
import { hasRouteAccess, isSuperAdminRole } from "../../../lib/rbac";

export default function PaymentMethodsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<PaymentSettingsDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canEdit = isSuperAdminRole(user?.role);
  // Finance and management can view this page but not the Settings home.
  const canOpenSettingsHome = hasRouteAccess(user?.role, "/settings");

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setSettings(await api.payments.getSettings());
    } catch (err: unknown) {
      setLoadError(apiErrorMessage(err, "Could not load payment methods."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  let content: React.ReactNode;
  if (settings) {
    content = (
      <PaymentMethodsForm
        saved={settings}
        canEdit={canEdit}
        onSaved={setSettings}
      />
    );
  } else if (isLoading) {
    content = (
      <div
        role="status"
        className="flex h-56 flex-col items-center justify-center gap-3 rounded-xl border border-[#EBE7F5] bg-white shadow-xs"
      >
        <Loader2
          aria-hidden="true"
          className="h-7 w-7 animate-spin text-[#23055c]"
        />
        <p className="text-sm text-slate-600">Loading payment methods…</p>
      </div>
    );
  } else {
    content = (
      <InlineAlert
        tone="error"
        role="alert"
        title="Couldn't load payment methods"
      >
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => void loadSettings()}
          className={cn(SECONDARY_BUTTON, "mt-3")}
        >
          Try again
        </button>
      </InlineAlert>
    );
  }

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {canOpenSettingsHome && (
        <Link
          href="/settings"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg text-sm font-semibold text-slate-600 transition-colors hover:text-[#23055c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23055c]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to Settings
        </Link>
      )}

      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-[#23055c] shadow-xs">
          <Wallet aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
            Payment methods
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Choose how members can pay at checkout, and where bank transfers go.
          </p>
        </div>
      </div>

      {!canEdit && (
        <InlineAlert tone="info" title="View only">
          Only a super admin can change payment methods.
        </InlineAlert>
      )}

      {content}
    </div>
  );
}
