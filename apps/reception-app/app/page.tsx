"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  QrCode,
  CheckCircle2,
  XCircle,
  Search,
  ShieldCheck,
  Clock,
  LogOut,
  LogIn,
  Wifi,
  Users,
  RefreshCw,
  Camera,
  CameraOff,
  Keyboard,
  Lock,
  Loader2,
  Sparkles,
  ChevronRight,
  ExternalLink,
  Shield,
  ArrowRight,
  HelpCircle,
  Calendar,
  MapPin,
  AlertTriangle,
  Info,
  UserCheck,
} from "lucide-react";
import { api, useAuth } from "@daih/api-client";
import {
  BookingState,
  AccessRejectionReason,
  VerifyAccessPassResponse,
  AccessPassDetails,
  TerminalActivityRecord,
  LiveOccupancyDTO,
  ReceptionTerminalSummaryDTO,
  ReceptionShiftMetrics,
} from "@daih/types";
import { Html5Qrcode } from "html5-qrcode";

type ScannerMode = "CAMERA" | "HARDWARE" | "MANUAL";

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "--";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatTimeOnly(dateStr?: string | null) {
  if (!dateStr) return "--";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Plays a pleasant scan beep using Web Audio API
 */
function playScanBeep(success = true) {
  try {
    if (typeof window === "undefined") return;
    const AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(success ? 880 : 330, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);

    if (navigator.vibrate) {
      navigator.vibrate(success ? [50, 50, 50] : [200]);
    }
  } catch {}
}

export default function ReceptionScannerPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading, logout } = useAuth();
  const [mounted, setMounted] = useState(false);

  const [activeMode, setActiveMode] = useState<ScannerMode>("CAMERA");
  const [hardwareInput, setHardwareInput] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AccessPassDetails[]>([]);
  const [searchHasExecuted, setSearchHasExecuted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [verificationResult, setVerificationResult] =
    useState<VerifyAccessPassResponse | null>(null);
  const [lastActionNotice, setLastActionNotice] = useState<string | null>(null);

  // Telemetry state
  const [occupancy, setOccupancy] = useState<LiveOccupancyDTO | null>(null);
  const [activity, setActivity] = useState<TerminalActivityRecord[]>([]);
  const [shiftMetrics, setShiftMetrics] =
    useState<ReceptionShiftMetrics | null>(null);
  const [isTelemetryLoading, setIsTelemetryLoading] = useState(false);

  // Camera scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<
    { id: string; label: string }[]
  >([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "reception-qr-reader";
  const hardwareInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clock state
  const [currentTime, setCurrentTime] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch consolidated telemetry in a single round-trip
  const fetchTelemetry = useCallback(
    async (isManual = false) => {
      if (!user) return;
      setIsTelemetryLoading(true);
      try {
        const summary = await api.access.getTerminalSummary({
          forceRefresh: isManual,
        });
        if (summary) {
          setOccupancy(summary.occupancy);
          setActivity(summary.recentActivity || []);
          setShiftMetrics(summary.shiftMetrics);
        }
      } catch (err) {
        console.warn("Could not fetch terminal telemetry summary:", err);
      } finally {
        setIsTelemetryLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    if (user) {
      fetchTelemetry();
      const interval = setInterval(fetchTelemetry, 30000);
      return () => clearInterval(interval);
    }
  }, [user, fetchTelemetry]);

  // Handle Token / Reference Verification
  const handleVerifyPass = useCallback(async (tokenOrRef: string) => {
    const clean = tokenOrRef.trim();
    if (!clean) return;

    setIsVerifying(true);
    setLastActionNotice(null);
    try {
      const response = await api.access.verifyPass(clean);
      setVerificationResult(response);
      playScanBeep(response.valid);
    } catch (err: any) {
      setVerificationResult({
        valid: false,
        rejectionReason: AccessRejectionReason.INVALID_SIGNATURE,
        rejectionTitle: "Verification Error",
        rejectionMessage:
          err?.message || "Failed to communicate with verification API.",
      });
      playScanBeep(false);
    } finally {
      setIsVerifying(false);
    }
  }, []);

  // Initialize Camera Scanner
  const startCamera = useCallback(async () => {
    if (!user) return;
    try {
      setCameraError(null);
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          await html5QrCodeRef.current.clear();
        } catch {}
      }

      // Check if container exists in DOM
      const container = document.getElementById(scannerContainerId);
      if (!container) {
        setCameraError(
          "Scanner element not ready. Please switch modes or refresh.",
        );
        return;
      }

      const html5Qr = new Html5Qrcode(scannerContainerId, {
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        verbose: false,
      });
      html5QrCodeRef.current = html5Qr;

      // Try camera devices enumeration
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setAvailableCameras(
            devices.map((d) => ({
              id: d.id,
              label: d.label || `Camera ${d.id.slice(0, 5)}`,
            })),
          );
        }
      } catch {}

      // Prefer environment facing mode (rear camera) or user selected ID
      const cameraConfig = selectedCameraId
        ? { deviceId: { exact: selectedCameraId } }
        : { facingMode: "environment" };

      await html5Qr.start(
        cameraConfig,
        {
          fps: 20,
          aspectRatio: 1.0,
          disableFlip: false,
        },
        (decodedText) => {
          handleVerifyPass(decodedText);
        },
        () => {}, // ignore non-QR frame noise
      );

      setCameraActive(true);
    } catch (err: any) {
      console.warn("Camera start notice:", err?.message);
      setCameraError(
        "Camera access denied or unavailable. Please grant camera permission in your browser or switch to Hardware / Manual mode.",
      );
      setCameraActive(false);
    }
  }, [user, handleVerifyPass, selectedCameraId]);

  const stopCamera = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch {}
      html5QrCodeRef.current = null;
      setCameraActive(false);
    }
  }, []);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (user && activeMode === "CAMERA") {
      timeout = setTimeout(() => {
        startCamera();
      }, 100);
    } else {
      stopCamera();
    }
    return () => {
      clearTimeout(timeout);
      stopCamera();
    };
  }, [user, activeMode, startCamera, stopCamera]);

  // Handle Image File QR Scan
  const handleFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsVerifying(true);
      const scanner =
        html5QrCodeRef.current || new Html5Qrcode(scannerContainerId);
      const decodedText = await scanner.scanFile(file, true);
      handleVerifyPass(decodedText);
    } catch (err: any) {
      alert("Could not detect a valid QR code in this image.");
    } finally {
      setIsVerifying(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Handle Hardware USB Scanner Input
  const handleHardwareSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hardwareInput.trim()) {
      handleVerifyPass(hardwareInput.trim());
      setHardwareInput("");
    }
  };

  // Handle Manual Search
  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = manualQuery.trim();
    if (!query) {
      setSearchResults([]);
      setVerificationResult(null);
      setLastActionNotice(null);
      setSearchHasExecuted(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setSearchHasExecuted(true);
    // Reset previous selection/inspection card so stale data is never retained
    setVerificationResult(null);
    setLastActionNotice(null);

    try {
      const results = await api.access.searchBookings(query);
      const list = results || [];
      setSearchResults(list);
      if (list.length === 0) {
        setVerificationResult(null);
      }
    } catch (err: any) {
      console.warn("Manual search error:", err);
      setSearchError(
        err?.message ||
          "Failed to search reservations. Please check network connection.",
      );
      setSearchResults([]);
      setVerificationResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  // Process Check-In Action
  const handleProcessCheckIn = async () => {
    if (!verificationResult?.booking?.bookingId) return;

    setIsActionLoading(true);
    try {
      const res = await api.access.checkIn(
        verificationResult.booking.bookingId,
        {
          terminalId: "REC-GATE-01",
          notes: "Checked in via Reception Terminal",
        },
      );

      setLastActionNotice(
        res.isReEntry
          ? `✓ Member Return Recorded: ${res.booking.customerName} re-checked in.`
          : `✓ Check-In Confirmed: ${res.booking.customerName} checked in. Wi-Fi credentials issued.`,
      );

      await handleVerifyPass(verificationResult.booking.bookingId);
      fetchTelemetry();
    } catch (err: any) {
      alert(`Check-in failed: ${err?.message || "Internal error"}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Process Check-Out Action
  const handleProcessCheckOut = async () => {
    if (!verificationResult?.booking?.bookingId) return;

    setIsActionLoading(true);
    try {
      const res = await api.access.checkOut(
        verificationResult.booking.bookingId,
        {
          terminalId: "REC-GATE-01",
          notes: "Checked out via Reception Terminal",
        },
      );

      setLastActionNotice(
        `✓ Check-Out Recorded: Departure logged for ${res.booking.customerName}. Internet remains active until scheduled end time.`,
      );

      await handleVerifyPass(verificationResult.booking.bookingId);
      fetchTelemetry();
    } catch (err: any) {
      alert(`Check-out failed: ${err?.message || "Internal error"}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Clear verification
  const handleClearVerification = () => {
    setVerificationResult(null);
    setLastActionNotice(null);
    if (activeMode === "HARDWARE" && hardwareInputRef.current) {
      hardwareInputRef.current.focus();
    }
  };

  // Loading / Resolving Session Gate
  if (!mounted || isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#f7f9ff] flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EBE7F5] text-[#23055c] flex items-center justify-center shadow-xs">
            <Loader2 className="w-6 h-6 animate-spin text-[#23055c]" />
          </div>
          <span className="text-xs font-bold text-slate-500 tracking-tight">
            Loading Reception Terminal...
          </span>
        </div>
      </div>
    );
  }

  // Unauthenticated Gate Screen
  if (!user) {
    return (
      <div className="bg-[#ebeef3] min-h-screen flex items-center justify-center p-4 md:p-8 font-sans antialiased text-[#181c20] relative overflow-hidden">
        {/* Ambient background decoration */}
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none -z-10 opacity-30">
          <div className="w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-[#392271]/20 to-transparent absolute blur-[100px] -top-[150px] -right-[150px]" />
          <div className="w-[500px] h-[500px] rounded-full bg-gradient-to-bl from-[#bfa9fe]/30 to-transparent absolute blur-[80px] -bottom-[100px] -left-[100px]" />
        </div>

        <div className="w-full max-w-md bg-white rounded-2xl border border-[#EBE7F5] shadow-[0px_12px_32px_rgba(57,34,113,0.08)] overflow-hidden text-center p-8 space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-[#EBE7F5] border border-purple-200 text-[#23055c] flex items-center justify-center mx-auto shadow-xs">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-bold text-[#181c20]">
              Terminal Locked
            </h2>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Sign in with authorized staff credentials to unlock hardware
              scanner terminal.
            </p>
          </div>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-3.5 bg-[#392271] hover:bg-[#23055c] text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Sign In to Unlock Terminal</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-background flex flex-col font-sans antialiased">
      {/* Top App Header */}
      <header className="bg-white/95 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 lg:px-8 py-3.5 border-b border-[#EBE7F5] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/images/logo.png"
              alt="DAIH Workspace Logo"
              className="h-8 w-auto object-contain"
            />
            <span className="font-extrabold text-base sm:text-lg text-[#23055c] tracking-tight">
              DAIH Reception
            </span>
          </Link>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <span className="px-2.5 py-0.5 rounded-full bg-[#EBE7F5] text-[#23055c] text-[11px] font-bold border border-purple-200 uppercase tracking-wide">
              Gate Terminal
            </span>
            <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500">
              <span>•</span>
              <span
                className="font-semibold text-slate-700"
                suppressHydrationWarning
              >
                {user
                  ? `${user.firstName} ${user.lastName}`
                  : "Officer on Duty"}
              </span>
              <span>•</span>
              <span
                className="font-mono text-[#23055c] font-bold bg-slate-100 px-2 py-0.5 rounded-md text-[11px]"
                suppressHydrationWarning
              >
                {currentTime || "--:--:--"}
              </span>
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs & Actions */}
        <div className="flex items-center gap-2 sm:gap-3 self-start sm:self-auto">
          {/* Mode Tabs */}
          <div className="flex items-center bg-[#F8F9FA] p-1 rounded-xl border border-slate-200 shadow-xs">
            <button
              onClick={() => setActiveMode("CAMERA")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeMode === "CAMERA"
                  ? "bg-[#23055c] text-white shadow-xs font-bold"
                  : "text-slate-600 hover:text-[#23055c] hover:bg-slate-200/50"
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Camera</span>
            </button>
            <button
              onClick={() => setActiveMode("HARDWARE")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeMode === "HARDWARE"
                  ? "bg-[#23055c] text-white shadow-xs font-bold"
                  : "text-slate-600 hover:text-[#23055c] hover:bg-slate-200/50"
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>USB Scanner</span>
            </button>
            <button
              onClick={() => setActiveMode("MANUAL")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeMode === "MANUAL"
                  ? "bg-[#23055c] text-white shadow-xs font-bold"
                  : "text-slate-600 hover:text-[#23055c] hover:bg-slate-200/50"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Manual Search</span>
            </button>
          </div>

          {/* Sign Out Button */}
          <button
            onClick={() => logout()}
            title="Sign Out Officer"
            className="p-2 rounded-xl bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 transition cursor-pointer shadow-xs"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Scanner / Input Controls */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          {/* Active Mode Scanner Box */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[#10b981] animate-pulse" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#23055c]">
                  {activeMode === "CAMERA"
                    ? "Camera QR Code Scanner"
                    : activeMode === "HARDWARE"
                      ? "Hardware 2D Barcode Reader"
                      : "Manual Member Lookup"}
                </h2>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                {activeMode === "CAMERA"
                  ? "Sensor Active"
                  : activeMode === "HARDWARE"
                    ? "Wedge Auto-Submit Ready"
                    : "Instant Lookup"}
              </span>
            </div>

            {/* Mode 1: Live Camera Viewport */}
            {activeMode === "CAMERA" && (
              <div className="space-y-4">
                <div className="relative w-full aspect-video sm:aspect-square max-h-72 bg-slate-900 rounded-xl overflow-hidden border border-slate-200 flex items-center justify-center shadow-inner">
                  <div
                    id={scannerContainerId}
                    className="w-full h-full object-cover"
                  />
                  {cameraError && (
                    <div className="absolute inset-0 bg-white/95 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-20">
                      <CameraOff className="w-10 h-10 text-rose-500 mb-2" />
                      <p className="text-xs text-rose-700 font-semibold mb-3 max-w-xs">
                        {cameraError}
                      </p>
                      <button
                        onClick={startCamera}
                        className="px-4 py-2 bg-[#23055c] hover:bg-[#392271] text-xs font-bold text-white rounded-lg transition shadow-xs cursor-pointer"
                      >
                        Retry Camera
                      </button>
                    </div>
                  )}
                </div>

                {availableCameras.length > 1 && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-medium">Camera source:</span>
                    <select
                      value={selectedCameraId}
                      onChange={(e) => setSelectedCameraId(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-[#23055c]"
                    >
                      {availableCameras.map((cam) => (
                        <option key={cam.id} value={cam.id}>
                          {cam.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-slate-500 font-medium">
                    Hold member QR code steadily in front of the lens.
                  </p>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileScan}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] text-[#23055c] hover:text-[#392271] font-bold underline underline-offset-2 cursor-pointer"
                    >
                      Scan Image File
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 2: Hardware USB Scanner */}
            {activeMode === "HARDWARE" && (
              <div className="space-y-5 py-2">
                <div className="h-44 bg-[#F8F9FA] rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center p-6 text-center">
                  <QrCode className="h-12 w-12 text-[#23055c] mb-2 animate-pulse" />
                  <p className="text-xs font-bold text-[#181c20]">
                    Ready for Hardware Scan
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-xs leading-relaxed">
                    Aim USB/Bluetooth scanner gun at member pass. Scans decode &
                    validate automatically on Enter.
                  </p>
                </div>

                <form onSubmit={handleHardwareSubmit} className="flex gap-2">
                  <input
                    ref={hardwareInputRef}
                    type="text"
                    placeholder="Scan pass or enter DAIH-BK-..."
                    value={hardwareInput}
                    onChange={(e) => setHardwareInput(e.target.value)}
                    autoFocus
                    className="flex-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-[#23055c] focus:ring-2 focus:ring-[#23055c] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isVerifying || !hardwareInput.trim()}
                    className="px-6 py-3 bg-[#23055c] hover:bg-[#392271] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition shadow-xs cursor-pointer"
                  >
                    {isVerifying ? "Verifying..." : "Validate"}
                  </button>
                </form>
              </div>
            )}

            {/* Mode 3: Manual Search */}
            {activeMode === "MANUAL" && (
              <div className="space-y-4 py-2">
                <form onSubmit={handleManualSearch} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Search by name, reference, email, client ID..."
                    value={manualQuery}
                    onChange={(e) => {
                      const val = e.target.value;
                      setManualQuery(val);
                      if (!val.trim()) {
                        setSearchResults([]);
                        setVerificationResult(null);
                        setLastActionNotice(null);
                        setSearchHasExecuted(false);
                        setSearchError(null);
                      }
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-[#23055c] focus:ring-2 focus:ring-[#23055c] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isSearching || !manualQuery.trim()}
                    className="px-5 py-2.5 bg-[#23055c] hover:bg-[#392271] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    {isSearching && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>{isSearching ? "Searching..." : "Search"}</span>
                  </button>
                </form>

                {searchError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{searchError}</span>
                  </div>
                )}

                {isSearching ? (
                  <div className="py-8 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-[#23055c]" />
                    <span className="text-xs font-medium">
                      Looking up reservations...
                    </span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div
                    className="max-h-60 overflow-y-auto space-y-2 pr-1"
                    role="listbox"
                    aria-label="Visitor search results"
                  >
                    {searchResults.map((b) => {
                      const isSelected =
                        verificationResult?.booking?.bookingId === b.bookingId;
                      return (
                        <button
                          key={b.bookingId}
                          type="button"
                          tabIndex={0}
                          aria-label={`Select visitor ${b.customerName}, resource ${b.resourceName}, reference ${b.reference}`}
                          onClick={() => handleVerifyPass(b.bookingId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleVerifyPass(b.bookingId);
                            }
                          }}
                          className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#23055c] ${
                            isSelected
                              ? "bg-[#EBE7F5] border-[#23055c] ring-1 ring-[#23055c]/30 shadow-xs"
                              : "bg-[#F8F9FA] hover:bg-[#EBE7F5]/50 border-slate-200"
                          }`}
                        >
                          <div>
                            <p className="text-xs font-bold text-[#181c20]">
                              {b.customerName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {b.resourceName} ·{" "}
                              <span className="font-mono text-[#23055c] font-semibold">
                                {b.reference}
                              </span>
                            </p>
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border shadow-2xs ${
                              isSelected
                                ? "bg-white border-[#23055c] text-[#23055c]"
                                : "bg-white border-slate-200 text-slate-700"
                            }`}
                          >
                            {b.state}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : searchHasExecuted ? (
                  <div className="py-6 text-center text-slate-500 space-y-1">
                    <p className="text-xs font-bold text-slate-700">
                      No Reservations Found
                    </p>
                    <p className="text-[11px] text-slate-400">
                      No active bookings match &quot;{manualQuery}&quot;. Please
                      verify the spelling or reference ID.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 text-center py-6">
                    Type a customer name, booking reference (e.g. DAIH-BK-...),
                    or email to look up reservations.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quick Real-Time Occupancy & Shift Telemetry Widget */}
          {occupancy && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[#23055c]" />
                  <span>Live Shift Telemetry &amp; Occupancy</span>
                </h3>
                <span className="text-xs font-bold text-[#23055c]">
                  {occupancy.totalCheckedIn} / {occupancy.totalCapacity} In Hub
                  ({occupancy.overallOccupancyRate}%)
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200 mb-3">
                <div
                  className="bg-gradient-to-r from-[#23055c] to-[#65519f] h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, occupancy.overallOccupancyRate)}%`,
                  }}
                />
              </div>

              {/* Shift Key Performance Indicators */}
              {shiftMetrics && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 pb-3 border-b border-slate-100">
                  <div className="p-2 bg-purple-50/60 rounded-xl border border-purple-100 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#23055c]">
                      Shift Check-Ins
                    </p>
                    <p className="text-sm font-extrabold text-[#23055c] mt-0.5">
                      {shiftMetrics.todayCheckedInCount}
                    </p>
                  </div>
                  <div className="p-2 bg-emerald-50/60 rounded-xl border border-emerald-100 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                      On-Site
                    </p>
                    <p className="text-sm font-extrabold text-emerald-800 mt-0.5">
                      {shiftMetrics.currentlyOnSiteCount}
                    </p>
                  </div>
                  <div className="p-2 bg-amber-50/60 rounded-xl border border-amber-100 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                      Departures
                    </p>
                    <p className="text-sm font-extrabold text-amber-800 mt-0.5">
                      {shiftMetrics.todayDeparturesCount}
                    </p>
                  </div>
                  <div className="p-2 bg-blue-50/60 rounded-xl border border-blue-100 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-800">
                      Expected
                    </p>
                    <p className="text-sm font-extrabold text-blue-800 mt-0.5">
                      {shiftMetrics.expectedArrivalsRemaining}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {occupancy.resources.slice(0, 4).map((r) => (
                  <div
                    key={r.resourceId}
                    className="p-2.5 bg-[#F8F9FA] rounded-xl border border-slate-200 text-center"
                  >
                    <p className="text-[10px] font-semibold text-slate-500 truncate">
                      {r.resourceName}
                    </p>
                    <p className="text-xs font-bold text-[#181c20] mt-0.5">
                      {r.currentOccupancy}/{r.capacity}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Verification Diagnostic & Action Hub */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          {/* Action notification banner */}
          {lastActionNotice && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center justify-between shadow-xs animate-fadeIn">
              <span>{lastActionNotice}</span>
              <button
                onClick={() => setLastActionNotice(null)}
                className="text-emerald-600 hover:text-emerald-950 font-bold ml-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Main Inspection: Comprehensive Booking Details Card */}
          {verificationResult?.booking ? (
            <div
              className={`bg-white border rounded-2xl p-5 sm:p-6 shadow-sm space-y-5 transition-all ${
                verificationResult.valid
                  ? "border-emerald-300 ring-1 ring-emerald-200/60"
                  : verificationResult.rejectionReason ===
                        AccessRejectionReason.EXPIRED &&
                      verificationResult.rejectionDetails?.isDailySlotRejection
                    ? "border-amber-300 ring-1 ring-amber-200/60"
                    : "border-rose-300 ring-1 ring-rose-200/60"
              }`}
            >
              {/* Top Status & Diagnostic Banner */}
              <div
                className={`p-4 rounded-xl border flex flex-col gap-2.5 ${
                  verificationResult.valid
                    ? "bg-emerald-50/80 border-emerald-200"
                    : verificationResult.rejectionReason ===
                          AccessRejectionReason.EXPIRED &&
                        verificationResult.rejectionDetails
                          ?.isDailySlotRejection
                      ? "bg-amber-50/80 border-amber-200"
                      : "bg-rose-50/80 border-rose-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0 ${
                        verificationResult.valid
                          ? "bg-emerald-100 text-emerald-700"
                          : verificationResult.rejectionReason ===
                                AccessRejectionReason.EXPIRED &&
                              verificationResult.rejectionDetails
                                ?.isDailySlotRejection
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {verificationResult.valid ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <XCircle className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h3
                        className={`text-sm font-bold ${
                          verificationResult.valid
                            ? "text-emerald-900"
                            : verificationResult.rejectionReason ===
                                  AccessRejectionReason.EXPIRED &&
                                verificationResult.rejectionDetails
                                  ?.isDailySlotRejection
                              ? "text-amber-900"
                              : "text-rose-900"
                        }`}
                      >
                        {verificationResult.valid
                          ? "Valid Access Pass"
                          : verificationResult.rejectionTitle ||
                            "Access Pass Restricted"}
                      </h3>
                      <p className="text-[11px] text-slate-600 font-medium">
                        {verificationResult.valid
                          ? verificationResult.isReEntry
                            ? "Member Returning (Same-Day Re-Entry)"
                            : "Ready for Terminal Action"
                          : `Reason: ${verificationResult.rejectionReason}`}
                      </p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      verificationResult.booking.state ===
                      BookingState.CHECKED_IN
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                        : verificationResult.booking.state ===
                            BookingState.CHECKED_OUT
                          ? "bg-amber-100 text-amber-800 border border-amber-200"
                          : verificationResult.booking.state ===
                              BookingState.EXPIRED
                            ? "bg-slate-200 text-slate-800 border border-slate-300"
                            : "bg-purple-100 text-[#23055c] border border-purple-200"
                    }`}
                  >
                    {verificationResult.booking.state}
                  </span>
                </div>

                {/* Explanatory Message & Front-Desk Guidance for Invalid Passes */}
                {!verificationResult.valid && (
                  <div className="pt-2 border-t border-slate-200/60 space-y-2 text-xs">
                    <p className="font-semibold text-slate-800 leading-relaxed">
                      {verificationResult.rejectionMessage}
                    </p>

                    {/* Operational Guidance for Receptionist */}
                    {verificationResult.rejectionDetails?.policyNotice && (
                      <div className="p-2.5 bg-white/80 rounded-lg border border-slate-200/70 text-[11px] text-slate-700 flex items-start gap-2">
                        <Info className="w-4 h-4 text-[#23055c] flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-slate-900">
                            Receptionist Notice:{" "}
                          </span>
                          <span>
                            {verificationResult.rejectionDetails.policyNotice}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Member Profile Card (Email and Phone completely omitted for Privacy) */}
              <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#23055c] text-white flex items-center justify-center font-bold text-base shadow-xs">
                    {verificationResult.booking.customerName
                      ?.charAt(0)
                      ?.toUpperCase() || "M"}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Member Profile
                    </p>
                    <p className="text-base font-extrabold text-[#181c20] leading-tight">
                      {verificationResult.booking.customerName}
                    </p>
                    {verificationResult.booking.clientId && (
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-purple-50 text-[#23055c] text-[11px] font-mono font-bold border border-purple-200">
                        {verificationResult.booking.clientId}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Booking Reference
                  </p>
                  <p className="text-xs font-mono font-bold text-[#23055c] bg-white px-2.5 py-1 rounded-lg border border-slate-200 mt-0.5">
                    {verificationResult.booking.reference}
                  </p>
                </div>
              </div>

              {/* Workspace Resource & Allocation Details */}
              <div className="p-4 bg-[#F8F9FA] rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#23055c]" />
                    <span>Allocated Workspace</span>
                  </p>
                  <p className="font-extrabold text-[#181c20] text-sm sm:text-base">
                    {verificationResult.booking.resourceName}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {verificationResult.booking.category || "Coworking Space"}
                    {verificationResult.booking.resourceLocation &&
                      ` · ${verificationResult.booking.resourceLocation}`}
                  </p>
                </div>

                <div className="flex sm:flex-col sm:items-end gap-2 text-right">
                  {verificationResult.booking.planName && (
                    <span className="px-2.5 py-1 rounded-md bg-purple-50 text-[#23055c] text-[11px] font-bold border border-purple-200">
                      {verificationResult.booking.planName}
                    </span>
                  )}
                  {verificationResult.booking.resourceCapacity && (
                    <span className="text-[11px] text-slate-500 font-medium">
                      Capacity: {verificationResult.booking.resourceCapacity}{" "}
                      Seat(s)
                    </span>
                  )}
                </div>
              </div>

              {/* Time Slots & Schedule Windows */}
              <div className="p-4 bg-[#F8F9FA] rounded-xl border border-slate-200 space-y-3 text-xs text-slate-700">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2.5 border-b border-slate-200/80">
                  <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                    <Calendar className="w-3.5 h-3.5 text-[#23055c]" />
                    <span>Reservation Period:</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#181c20]">
                      {formatDateTime(verificationResult.booking.startTime)} —{" "}
                      {formatDateTime(verificationResult.booking.endTime)}
                    </span>
                    {verificationResult.booking.isMultiDay && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-purple-100 text-[#23055c] text-[10px] font-bold">
                        {verificationResult.booking.totalDays}-Day Pass (Day{" "}
                        {verificationResult.booking.currentDayNumber} of{" "}
                        {verificationResult.booking.totalDays})
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                    <Clock className="w-3.5 h-3.5 text-[#23055c]" />
                    <span>Today's Daily Access Window:</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#181c20]">
                      {verificationResult.booking.dailySlotHours ||
                        `${new Date(verificationResult.booking.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — ${new Date(verificationResult.booking.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        verificationResult.booking.isSlotConcludedToday
                          ? "bg-rose-100 text-rose-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {verificationResult.booking.isSlotConcludedToday
                        ? "Concluded Today"
                        : "Operating Window Open"}
                    </span>
                  </div>
                </div>

                {verificationResult.booking.checkedInAt && (
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <span className="text-slate-500">
                      First Check-In Today:
                    </span>
                    <span className="text-emerald-700 font-mono font-bold">
                      {formatTimeOnly(verificationResult.booking.checkedInAt)}
                    </span>
                  </div>
                )}

                {verificationResult.booking.checkedOutAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">
                      Last Departure Today:
                    </span>
                    <span className="text-amber-700 font-mono font-bold">
                      {formatTimeOnly(verificationResult.booking.checkedOutAt)}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span className="text-slate-500">Total Visit Sessions:</span>
                  <span className="text-slate-800 font-semibold">
                    {verificationResult.booking.visitCount || 0} session(s)
                    recorded
                  </span>
                </div>
              </div>

              {/* Wi-Fi Credential Card */}
              {verificationResult.booking.wifiCredentials ? (
                <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Wifi className="w-5 h-5 text-emerald-700 flex-shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-900">
                        {verificationResult.booking.wifiCredentials.ssid}
                      </p>
                      <p className="text-[11px] text-slate-600 font-mono">
                        User:{" "}
                        <span className="text-slate-900 font-semibold">
                          {verificationResult.booking.wifiCredentials.username}
                        </span>{" "}
                        · PIN:{" "}
                        <span className="text-amber-700 font-bold">
                          {verificationResult.booking.wifiCredentials.pin}
                        </span>
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Active
                  </span>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between text-slate-500">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-slate-400" />
                    <span>Member Wi-Fi Access</span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600">
                    {verificationResult.booking.wifiStatus === "EXPIRED"
                      ? "Expired with Pass"
                      : verificationResult.booking.wifiStatus ===
                          "LOCKED_PENDING_DAILY_CHECKIN"
                        ? "Locked (Requires Daily Check-In)"
                        : "Locked"}
                  </span>
                </div>
              )}

              {/* Dynamic Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                {verificationResult.canCheckIn && (
                  <button
                    onClick={handleProcessCheckIn}
                    disabled={isActionLoading}
                    className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>
                      {verificationResult.isReEntry
                        ? "Process Re-Check In (Member Return)"
                        : "Confirm Member Check-In"}
                    </span>
                  </button>
                )}

                {verificationResult.canCheckOut && (
                  <button
                    onClick={handleProcessCheckOut}
                    disabled={isActionLoading}
                    className="flex-1 py-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Process Midday Check-Out</span>
                  </button>
                )}

                <button
                  onClick={handleClearVerification}
                  className="px-5 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  Dismiss &amp; Next Scan
                </button>
              </div>
            </div>
          ) : verificationResult && !verificationResult.valid ? (
            /* Scenario 2: Rejection Diagnostics when no booking record found */
            <div className="bg-white border border-rose-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold flex-shrink-0">
                  <XCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-rose-700">
                    {verificationResult.rejectionTitle ||
                      "Access Pass Rejected"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Reason:{" "}
                    <span className="font-mono text-rose-700 font-bold">
                      {verificationResult.rejectionReason}
                    </span>
                  </p>
                </div>
              </div>

              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3 text-xs">
                <p className="text-rose-900 leading-relaxed font-medium">
                  {verificationResult.rejectionMessage}
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleClearVerification}
                  className="w-full py-3.5 rounded-xl bg-[#23055c] hover:bg-[#392271] text-white font-bold text-xs transition cursor-pointer shadow-xs"
                >
                  Dismiss &amp; Scan Next Pass
                </button>
              </div>
            </div>
          ) : (
            /* Scenario 3: Idle / Ready State */
            <div className="bg-white border border-slate-200/80 rounded-2xl p-10 text-center text-slate-500 flex flex-col items-center justify-center min-h-[320px] shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-[#EBE7F5] border border-purple-200 text-[#23055c] flex items-center justify-center mb-4 shadow-xs">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-bold text-[#181c20]">
                Awaiting Access Pass Scan
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
                Point camera at customer QR code, scan with USB reader, or
                search by reference. Validations and actions will appear here
                instantly.
              </p>
            </div>
          )}

          {/* Shift Activity Log */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex-1">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#23055c]" />
                <span>Recent Shift Activity</span>
              </h3>
              <button
                onClick={() => fetchTelemetry(true)}
                disabled={isTelemetryLoading}
                className="text-slate-400 hover:text-[#23055c] transition text-xs p-1 cursor-pointer"
                title="Refresh logs"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    isTelemetryLoading ? "animate-spin" : ""
                  }`}
                />
              </button>
            </div>

            {activity.length > 0 ? (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {activity.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-2.5 bg-[#F8F9FA] hover:bg-slate-100/80 rounded-xl border border-slate-200/80 flex items-center justify-between text-xs transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] ${
                          rec.action === "CHECK_IN"
                            ? "bg-emerald-100 text-emerald-800"
                            : rec.action === "CHECK_OUT"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-purple-100 text-[#23055c]"
                        }`}
                      >
                        {rec.action === "CHECK_IN"
                          ? "IN"
                          : rec.action === "CHECK_OUT"
                            ? "OUT"
                            : "RE"}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-xs">
                          {rec.customerName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {rec.resourceName} ·{" "}
                          <span className="font-mono text-slate-700">
                            {rec.bookingReference}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono font-medium">
                      {new Date(rec.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 text-center py-6">
                No shift activity recorded yet today.
              </p>
            )}
          </div>
        </div>
      </main>

      {/* Shared Platform Footer */}
      <footer className="bg-[#23055c] text-white w-full px-4 sm:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 mt-auto border-t border-[#392271] text-xs">
        <div className="font-bold tracking-tight text-sm">DAIH Workspace</div>
        <nav className="flex flex-wrap justify-center gap-4 sm:gap-6 text-slate-300 text-xs">
          <span>Reception Gate Terminal</span>
          <span>•</span>
          <span>Hardware Scanner Wedge Active</span>
          <span>•</span>
          <span>Access Telemetry Sync</span>
        </nav>
        <div className="text-slate-400 text-xs">
          © 2026 DAIH Hub. Authorized Terminal Access.
        </div>
      </footer>
    </div>
  );
}
