"use client";

import React, { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@daih/api-client";
import { useToast } from "@daih/ui";
import { Loader2 } from "lucide-react";

interface GoogleAuthButtonProps {
  text?: "signin_with" | "signup_with" | "continue_with";
  disabled?: boolean;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (parent: HTMLElement, options: any) => void;
          prompt: (notification?: any) => void;
          cancel?: () => void;
        };
      };
    };
  }
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  text = "continue_with",
  disabled = false,
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithGoogle } = useAuth();
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [isButtonRendered, setIsButtonRendered] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const buttonContainerRef = useRef<HTMLDivElement>(null);

  const rawRedirect = searchParams?.get("redirectTo") || "";
  const targetDestination =
    rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/dashboard";

  const clientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    "mock-google-client-id.apps.googleusercontent.com";

  const isMockClientId =
    !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    clientId.includes("mock-google-client-id");

  // Check if SDK was already loaded in a previous navigation
  useEffect(() => {
    if (typeof window !== "undefined" && window.google?.accounts?.id) {
      setScriptLoaded(true);
    }
  }, []);

  // Developer warning if Client ID is unconfigured
  useEffect(() => {
    if (isMockClientId && process.env.NODE_ENV !== "production") {
      console.warn(
        "[GoogleAuthButton] NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured in .env.local. " +
          "Google Sign-In requires a valid Google Cloud Client ID for your authorized origin.",
      );
    }
  }, [isMockClientId]);

  const handleCredentialResponse = async (response: {
    credential?: string;
  }) => {
    if (!response.credential) {
      toast.error("Google sign-in failed. No credentials received.");
      return;
    }

    setIsLoading(true);
    try {
      // Retrieve referral code from localStorage or cookie
      let referralCode = "";
      try {
        referralCode =
          localStorage.getItem("daih_referral_code") ||
          searchParams.get("ref") ||
          searchParams.get("referralCode") ||
          "";

        if (!referralCode && typeof document !== "undefined") {
          const match = document.cookie.match(
            /(?:^|;\s*)daih_referral_code=([^;]+)/,
          );
          if (match && match[1]) {
            referralCode = decodeURIComponent(match[1]);
          }
        }
      } catch {}

      const result = await loginWithGoogle(
        response.credential,
        referralCode.trim().toUpperCase() || undefined,
        "customer",
      );

      toast.success(
        result.isNewUser
          ? "Welcome to DAIH! Your account has been created."
          : "Welcome back!",
      );

      if (result.needsConsent) {
        router.push(
          `/consent?destination=${encodeURIComponent(targetDestination)}`,
        );
      } else if (result.needsOnboarding) {
        router.push("/onboarding");
      } else {
        router.push(targetDestination);
      }
    } catch (err: any) {
      toast.error(err?.message || "Google sign-in failed. Please try again.", {
        title: "Authentication Error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const callbackRef = useRef(handleCredentialResponse);
  useEffect(() => {
    callbackRef.current = handleCredentialResponse;
  });

  useEffect(() => {
    if (
      !scriptLoaded ||
      !window.google?.accounts?.id ||
      !buttonContainerRef.current
    ) {
      return;
    }

    try {
      // Initialize only once per clientId to prevent GSI_LOGGER re-initialization warnings
      const currentInitializedId = (window as any).__daih_gsi_client_id;
      if (currentInitializedId !== clientId) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (res: any) => callbackRef.current(res),
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: false,
        });
        (window as any).__daih_gsi_client_id = clientId;
      }

      buttonContainerRef.current.innerHTML = "";
      const containerWidth = buttonContainerRef.current.offsetWidth || 340;
      const buttonWidth = Math.min(Math.max(containerWidth, 200), 400);

      window.google.accounts.id.renderButton(buttonContainerRef.current, {
        theme: "outline",
        size: "large",
        width: buttonWidth,
        text,
        shape: "rectangular",
        logo_alignment: "left",
      });

      setIsButtonRendered(true);
    } catch (err) {
      console.warn("Failed to render Google GSI button:", err);
    }

    return () => {
      try {
        window.google?.accounts?.id?.cancel?.();
      } catch {}
    };
  }, [scriptLoaded, clientId, text]);

  return (
    <div className="w-full relative min-h-[44px]">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => setScriptError(true)}
      />

      {/* Render target for Google's official button */}
      <div
        ref={buttonContainerRef}
        className={`w-full flex justify-center min-h-[44px] ${
          isLoading || disabled ? "pointer-events-none opacity-50" : ""
        }`}
      />

      {/* Loading Skeleton displayed until Google SDK renders the official button */}
      {!isButtonRendered && !scriptError && (
        <div className="absolute inset-0 flex items-center justify-center gap-2.5 py-2 px-4 bg-white border border-slate-200 rounded-xl text-slate-500 text-xs font-semibold shadow-sm z-10 animate-pulse pointer-events-none">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />
          <span>
            {text === "signup_with"
              ? "Connecting to Google..."
              : text === "signin_with"
                ? "Connecting to Google..."
                : "Connecting to Google..."}
          </span>
        </div>
      )}

      {/* Fallback displayed if Google SDK failed to load (e.g. adblocker, network error) */}
      {scriptError && (
        <button
          type="button"
          onClick={async () => {
            let referralCode = "";
            try {
              referralCode =
                localStorage.getItem("daih_referral_code") ||
                searchParams.get("ref") ||
                searchParams.get("referralCode") ||
                "";
            } catch {}
            const apiUrl =
              process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

            let codeChallengeParam = "";
            try {
              const array = new Uint8Array(32);
              window.crypto.getRandomValues(array);
              const verifier = Array.from(array, (dec) =>
                dec.toString(36).padStart(2, "0"),
              ).join("");
              sessionStorage.setItem("daih_pkce_verifier", verifier);

              const encoder = new TextEncoder();
              const data = encoder.encode(verifier);
              const hash = await window.crypto.subtle.digest("SHA-256", data);
              const hashArray = Array.from(new Uint8Array(hash));
              const base64 = btoa(String.fromCharCode(...hashArray));
              const challenge = base64
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");
              codeChallengeParam = `&code_challenge=${encodeURIComponent(
                challenge,
              )}&code_challenge_method=S256`;
            } catch (e) {
              console.warn("Could not generate PKCE challenge:", e);
            }

            window.location.href = `${apiUrl}/api/v1/identity/oauth/google?ref=${encodeURIComponent(
              referralCode,
            )}&destination=${encodeURIComponent(
              targetDestination,
            )}${codeChallengeParam}`;
          }}
          className="absolute inset-0 flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-slate-700 text-xs font-semibold shadow-sm transition-colors z-10 cursor-pointer"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>
      )}
    </div>
  );
};
