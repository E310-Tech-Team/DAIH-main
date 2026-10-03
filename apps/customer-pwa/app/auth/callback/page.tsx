"use client";

import React, { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, apiClient } from "@daih/api-client";
import { getSafeRedirectUrl } from "@daih/types";
import { Loader2 } from "lucide-react";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession, refreshSession } = useAuth();

  useEffect(() => {
    const code = searchParams?.get("code");
    const token = searchParams?.get("token");
    const rawDestination = searchParams?.get("destination") || "/dashboard";
    const destination = getSafeRedirectUrl(rawDestination, "/dashboard");
    const error = searchParams?.get("error");

    if (error) {
      router.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (code) {
      // 1. Pull PKCE code_verifier from sessionStorage and immediately clear it
      let codeVerifier: string | undefined;
      try {
        const stored = sessionStorage.getItem("daih_pkce_verifier");
        if (stored) {
          codeVerifier = stored;
          sessionStorage.removeItem("daih_pkce_verifier");
        }
      } catch {
        // Ignore storage access error
      }

      // 2. Exchange authorization code + PKCE verifier for tokens
      apiClient.auth
        .exchangeOAuthCode({ code, codeVerifier })
        .then((res) => {
          if (res.accessToken && res.user) {
            setSession(res.accessToken, res.user);
          }
          // 3. Immediately replace history state so code is removed from URL and referrer
          if (typeof window !== "undefined") {
            window.history.replaceState({}, "", destination);
          }
          router.replace(destination);
        })
        .catch((err: any) => {
          router.replace(
            `/login?error=${encodeURIComponent(
              err?.message ||
                "Authentication code exchange failed. Please sign in again.",
            )}`,
          );
        });
      return;
    }

    if (token) {
      apiClient.setAccessToken(token);
      apiClient.auth
        .getProfile()
        .then((user) => {
          setSession(token, user);
          if (typeof window !== "undefined") {
            window.history.replaceState({}, "", destination);
          }
          router.replace(destination);
        })
        .catch(() => {
          refreshSession()
            .then(() => {
              if (typeof window !== "undefined") {
                window.history.replaceState({}, "", destination);
              }
              router.replace(destination);
            })
            .catch(() =>
              router.replace("/login?error=Session+synchronization+failed"),
            );
        });
    } else {
      refreshSession()
        .then((user) => {
          if (user) {
            router.replace(destination);
          } else {
            router.replace("/login");
          }
        })
        .catch(() => {
          router.replace("/login");
        });
    }
  }, [searchParams, router, setSession, refreshSession]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white space-y-4">
      <Loader2 className="w-10 h-10 text-[#23055c] animate-spin" />
      <p className="text-sm font-medium text-slate-600">
        Completing secure sign-in...
      </p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <Loader2 className="w-8 h-8 text-[#23055c] animate-spin" />
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
