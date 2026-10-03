"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth, api } from "@daih/api-client";
import { Button, Input, useToast } from "@daih/ui";
import { resolveAvatarUrl } from "../../../lib/image-utils";
import { AvatarCropperModal } from "../../../components/dashboard";
import { MemberTierBadge } from "../../../components/loyalty/MemberTierBadge";
import {
  User,
  Shield,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Wifi,
  Mail,
  Phone,
  Lock,
  LogOut,
  Loader2,
  Eye,
  EyeOff,
  Camera,
  Trash2,
  Cake,
  FileText,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

export default function CustomerSettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const toast = useToast();

  // Avatar Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarSuccess, setAvatarSuccess] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [user?.avatarUrl]);

  // Avatar Cropper Modal State
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  // Profile Form State
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || "");
  const [birthMonth, setBirthMonth] = useState<string>("");
  const [birthDay, setBirthDay] = useState<string>("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Copy feedback state
  const [copiedClientId, setCopiedClientId] = useState(false);

  // Logout Confirmation State
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Remove Avatar Confirmation State
  const [showDeleteAvatarModal, setShowDeleteAvatarModal] = useState(false);

  // Deactivate Account State
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deactivateOtp, setDeactivateOtp] = useState("");
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivateAuthMethod, setDeactivateAuthMethod] = useState<
    "password" | "otp"
  >("password");
  const [isSendingDeactOtp, setIsSendingDeactOtp] = useState(false);
  const [otpSentMessage, setOtpSentMessage] = useState<string | null>(null);
  const [deactivateConfirmed, setDeactivateConfirmed] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Loyalty Wallet & Tier State
  const [wallet, setWallet] = useState<{
    tier?: string;
    tierMultiplier?: number;
    lifetimeEarned?: number;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    api.loyalty
      .getMyWallet(false)
      .then((w) => {
        if (isMounted) {
          setWallet({
            tier: w.tier,
            tierMultiplier: w.tierMultiplier,
            lifetimeEarned: w.lifetimeEarned,
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [user]);

  // Sync state when user profile loads
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setPhoneNumber(user.phoneNumber || "");
      if ((user as any).birthday) {
        const parts = ((user as any).birthday as string).split("-");
        if (parts.length === 2) {
          setBirthMonth(parts[0]);
          setBirthDay(parts[1]);
        }
      } else {
        setBirthMonth("");
        setBirthDay("");
      }
    }
  }, [user]);

  const resolvedAvatar = resolveAvatarUrl(user?.avatarUrl);

  // Handle Avatar File Selection (Open Crop Modal)
  const handleAvatarFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAvatarError("Please select a valid image file (PNG, JPG, WEBP).");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setAvatarError("Image file size must be less than 10MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setRawImageSrc(reader.result as string);
      setIsCropperOpen(true);
    };
    reader.readAsDataURL(file);
  };

  // Handle Cropped Image Upload
  const handleCropComplete = async (croppedBase64: string) => {
    setIsCropperOpen(false);
    setRawImageSrc(null);
    setIsUploadingAvatar(true);
    setAvatarSuccess(null);
    setAvatarError(null);

    try {
      const res = await api.auth.uploadAvatar({
        data: croppedBase64,
        contentType: "image/webp",
      });

      const updatedUser = (res as any)?.user || (res as any)?.data?.user;
      const avatarUrl =
        (res as any)?.avatarUrl || (res as any)?.data?.avatarUrl;

      if (updatedUser) {
        updateUser(updatedUser);
        setAvatarLoadError(false);
      } else if (avatarUrl && user) {
        updateUser({ ...user, avatarUrl });
        setAvatarLoadError(false);
      }

      setAvatarSuccess("Profile picture updated and saved!");
      toast.success("Your profile picture has been updated.", {
        title: "Photo Updated",
      });
      setTimeout(() => setAvatarSuccess(null), 4000);
    } catch (err: any) {
      const msg = err?.message || "Failed to upload profile picture.";
      setAvatarError(msg);
      toast.error(msg, { title: "Upload Failed" });
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Handle Avatar Delete
  const handleDeleteAvatar = async () => {
    setIsUploadingAvatar(true);
    setAvatarSuccess(null);
    setAvatarError(null);

    try {
      const res = await api.auth.deleteAvatar();
      if (res && res.user) {
        updateUser(res.user);
        setAvatarSuccess("Profile picture removed.");
        toast.success("Your profile picture has been removed.", {
          title: "Photo Removed",
        });
        setTimeout(() => setAvatarSuccess(null), 4000);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to remove profile picture.";
      setAvatarError(msg);
      toast.error(msg, { title: "Remove Failed" });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Handle Profile Update
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileSuccess(null);
    setProfileError(null);

    const birthday =
      birthMonth && birthDay
        ? `${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`
        : null;

    try {
      const updated = await api.auth.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        birthday,
      });

      if (updated) {
        updateUser(updated);
        setProfileSuccess("Profile updated successfully!");
        toast.success("Your profile details have been saved.", {
          title: "Profile Updated",
        });
        setTimeout(() => setProfileSuccess(null), 4000);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to update profile. Please try again.";
      setProfileError(msg);
      toast.error(msg, { title: "Update Failed" });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const passwordRules = [
    {
      id: "length",
      label: "8+ characters",
      valid: newPassword.length >= 8,
    },
    {
      id: "upper",
      label: "Uppercase (A-Z)",
      valid: /[A-Z]/.test(newPassword),
    },
    {
      id: "lower",
      label: "Lowercase (a-z)",
      valid: /[a-z]/.test(newPassword),
    },
    {
      id: "number",
      label: "Number (0-9)",
      valid: /[0-9]/.test(newPassword),
    },
    {
      id: "symbol",
      label: "Special (!@#$%...)",
      valid: /[^A-Za-z0-9]/.test(newPassword),
    },
  ];

  // Handle Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);

    if (!currentPassword) {
      const msg = "Please enter your current password.";
      setPasswordError(msg);
      toast.warning(msg, { title: "Current Password Required" });
      return;
    }

    // Comprehensive friendly password character requirement checks
    const missing: string[] = [];
    if (newPassword.length < 8) missing.push("at least 8 characters");
    if (!/[A-Z]/.test(newPassword)) missing.push("an uppercase letter (A-Z)");
    if (!/[a-z]/.test(newPassword)) missing.push("a lowercase letter (a-z)");
    if (!/[0-9]/.test(newPassword)) missing.push("a number (0-9)");
    if (!/[^A-Za-z0-9]/.test(newPassword))
      missing.push("a special symbol (!@#$%^&*)");

    if (missing.length > 0) {
      const friendlyMsg = `Your new password needs ${missing.join(", ")}.`;
      setPasswordError(friendlyMsg);
      toast.warning(friendlyMsg, {
        title: "Password Requirements",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      const msg = "The new passwords you entered do not match. Please verify.";
      setPasswordError(msg);
      toast.error(msg, { title: "Password Mismatch" });
      return;
    }

    setIsChangingPassword(true);

    try {
      const res = await api.auth.changePassword({
        currentPassword,
        newPassword,
      });

      if (res.success) {
        setPasswordSuccess("Password updated successfully!");
        toast.success("Your password has been changed successfully.", {
          title: "Password Updated",
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => setPasswordSuccess(null), 4000);
      }
    } catch (err: any) {
      let msg =
        err?.message ||
        "Failed to change password. Verify your current password.";

      // Translate technical backend / Zod validation error strings into user-friendly guidance
      if (
        msg.toLowerCase().includes("invalid request payload") ||
        msg.toLowerCase().includes("newpassword") ||
        msg.toLowerCase().includes("character") ||
        msg.toLowerCase().includes("invalid_string") ||
        msg.toLowerCase().includes("must contain")
      ) {
        msg =
          "Your new password must be at least 8 characters and include uppercase (A-Z), lowercase (a-z), numbers (0-9), and special symbols (!@#$%).";
      }

      setPasswordError(msg);
      toast.error(msg, {
        title: "Password Update Failed",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      window.location.href = "/login";
    } catch {
      window.location.href = "/login";
    }
  };

  const copyClientId = () => {
    if (user?.clientId) {
      navigator.clipboard.writeText(user.clientId);
      setCopiedClientId(true);
      setTimeout(() => setCopiedClientId(false), 2000);
    }
  };

  const handleRequestDeactivateOtp = async () => {
    setIsSendingDeactOtp(true);
    setDeactivateError(null);
    setOtpSentMessage(null);
    try {
      const res = await api.auth.requestDeactivationOtp();
      setOtpSentMessage(
        res.message || "A 6-digit confirmation code was sent to your email.",
      );
      toast.success("Verification code sent to your email.", {
        title: "Code Sent",
      });
    } catch (err: any) {
      const msg =
        err?.message || "Failed to send verification code. Please try again.";
      setDeactivateError(msg);
      toast.error(msg, { title: "Error" });
    } finally {
      setIsSendingDeactOtp(false);
    }
  };

  const handleConfirmDeactivation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deactivateConfirmed) return;
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      await api.auth.deactivateAccount({
        password:
          deactivateAuthMethod === "password" ? deactivatePassword : undefined,
        otp: deactivateAuthMethod === "otp" ? deactivateOtp.trim() : undefined,
        reason: deactivateReason || undefined,
      });

      toast.success(
        "Your account has been deactivated. You have been logged out.",
        {
          title: "Account Closed",
        },
      );
      await logout();
      window.location.href = "/login";
    } catch (err: any) {
      let msg = err?.message || "Failed to deactivate account.";
      if (msg.includes("ACTIVE_BOOKING_PREVENTS_CLOSURE")) {
        msg =
          "You have active upcoming bookings. Please cancel or complete them before deactivating your account.";
      } else if (msg.includes("OPEN_REFUND_PREVENTS_CLOSURE")) {
        msg =
          "You have an open refund request under review. Please await resolution before closing your account.";
      } else if (msg.includes("INVALID_CREDENTIALS")) {
        msg = "Incorrect password. Please verify your password.";
      } else if (msg.includes("INVALID_OTP") || msg.includes("OTP_EXPIRED")) {
        msg =
          "Invalid or expired verification code. Please request a new code.";
      }
      setDeactivateError(msg);
      toast.error(msg, { title: "Deactivation Failed" });
    } finally {
      setIsDeactivating(false);
    }
  };

  return (
    <div className="space-y-8 w-full pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EBE7F5] pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#181c20] tracking-tight">
            Account Settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage your personal profile details, profile picture, credentials,
            and preferences.
          </p>
        </div>

        {/* Member Badges (Tier & Client ID) */}
        <div className="flex flex-wrap items-center gap-3 shrink-0 self-start sm:self-auto">
          <MemberTierBadge
            variant="badge"
            tier={wallet?.tier}
            lifetimeEarned={wallet?.lifetimeEarned || 0}
            multiplier={wallet?.tierMultiplier}
            href="/loyalty"
          />

          {user?.clientId && (
            <button
              onClick={copyClientId}
              title="Click to copy Member ID"
              className="flex items-center gap-2 px-3.5 py-2 bg-white rounded-xl border border-[#EBE7F5] shadow-xs hover:border-[#23055c] transition-colors cursor-pointer"
            >
              <div className="text-left">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Member ID
                </span>
                <span className="font-mono text-xs font-bold text-[#23055c]">
                  {user.clientId}
                </span>
              </div>
              {copiedClientId ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <Copy className="w-4 h-4 text-slate-400" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Full-Width Profile Picture Card */}
      <div className="w-full bg-white rounded-2xl p-6 sm:p-7 border border-[#EBE7F5] shadow-xs space-y-5">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
          <Camera className="w-5 h-5 text-[#23055c]" />
          <h2 className="font-bold text-sm text-slate-900">Profile Picture</h2>
        </div>

        {avatarSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{avatarSuccess}</span>
          </div>
        )}

        {avatarError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{avatarError}</span>
          </div>
        )}

        <div className="flex flex-col items-center justify-center text-center py-2 space-y-4">
          <div className="relative group shrink-0">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-gradient-to-br from-[#23055c] to-[#392271] text-white flex items-center justify-center font-extrabold text-2xl sm:text-3xl shadow-md border-3 border-purple-200/80">
              {resolvedAvatar && !avatarLoadError ? (
                <img
                  key={resolvedAvatar}
                  src={resolvedAvatar}
                  alt={`${user?.firstName} ${user?.lastName}`}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarLoadError(true)}
                />
              ) : (
                <span>
                  {user?.firstName?.[0] || "M"}
                  {user?.lastName?.[0] || ""}
                </span>
              )}
            </div>
            {isUploadingAvatar && (
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">
              Your Avatar &amp; Photo
            </h3>
            <div className="flex items-center justify-center gap-2 pt-0.5">
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                JPG, PNG, WebP
              </span>
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                Max 10MB
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 justify-center pt-1">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarFileSelect}
              accept="image/png,image/jpeg,image/webp,image/jpg"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="px-5 py-2.5 bg-[#23055c] hover:bg-[#392271] text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              <span>{resolvedAvatar ? "Change Photo" : "Upload Photo"}</span>
            </button>

            {resolvedAvatar && (
              <button
                type="button"
                onClick={() => setShowDeleteAvatarModal(true)}
                disabled={isUploadingAvatar}
                className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs rounded-xl border border-rose-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid: Profile Form & Password Change */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        {/* Left Column: Personal Information (7 Cols) */}
        <div className="md:col-span-7 space-y-6">
          {/* Personal Information Form */}
          <div className="bg-white rounded-2xl p-6 sm:p-7 border border-[#EBE7F5] shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <User className="w-5 h-5 text-[#23055c]" />
                <h2 className="font-bold text-sm text-slate-900">
                  Personal Information
                </h2>
              </div>
            </div>

            {profileSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{profileSuccess}</span>
              </div>
            )}

            {profileError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{profileError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    First Name
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all"
                    placeholder="First Name"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all"
                    placeholder="Last Name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <input
                    type="email"
                    disabled
                    value={user?.email || ""}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 cursor-not-allowed"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Email address is linked to your verified pass and cannot be
                  altered directly.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Phone Number
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all"
                    placeholder="+234 800 000 0000"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Birthday (Day & Month) */}
              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                  <Cake className="w-3.5 h-3.5 text-[#23055c]" />
                  Birthday (Day &amp; Month)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <select
                      value={birthMonth}
                      onChange={(e) => setBirthMonth(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all cursor-pointer"
                    >
                      <option value="">Month</option>
                      <option value="01">January</option>
                      <option value="02">February</option>
                      <option value="03">March</option>
                      <option value="04">April</option>
                      <option value="05">May</option>
                      <option value="06">June</option>
                      <option value="07">July</option>
                      <option value="08">August</option>
                      <option value="09">September</option>
                      <option value="10">October</option>
                      <option value="11">November</option>
                      <option value="12">December</option>
                    </select>
                  </div>

                  <div>
                    <select
                      value={birthDay}
                      onChange={(e) => setBirthDay(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all cursor-pointer"
                    >
                      <option value="">Day</option>
                      {Array.from({ length: 31 }, (_, i) => {
                        const dayNum = String(i + 1).padStart(2, "0");
                        return (
                          <option key={dayNum} value={dayNum}>
                            {i + 1}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Used for birthday celebration perks, community treats, and
                  workspace rewards.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-5 py-2.5 bg-[#23055c] hover:bg-[#392271] text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSavingProfile ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Profile Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Security & Password Management (5 Cols) */}
        <div className="md:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl p-6 sm:p-7 border border-[#EBE7F5] shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <Shield className="w-5 h-5 text-[#23055c]" />
              <h2 className="font-bold text-sm text-slate-900">
                Security & Password
              </h2>
            </div>

            {passwordSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            {passwordError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all"
                    placeholder="Enter current password"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all"
                    placeholder="Minimum 8 characters"
                  />
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Live Password Strength Criteria Checklist */}
                {newPassword.length > 0 && (
                  <div className="mt-2 bg-slate-50 border border-slate-200/70 rounded-xl p-3 space-y-1.5 transition-all">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Password Requirements
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {passwordRules.map((rule) => (
                        <div
                          key={rule.id}
                          className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
                            rule.valid
                              ? "text-emerald-700 font-semibold"
                              : "text-slate-400"
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                              rule.valid
                                ? "bg-emerald-500 text-white"
                                : "bg-slate-200 text-slate-400"
                            }`}
                          >
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </div>
                          <span>{rule.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all"
                    placeholder="Confirm new password"
                  />
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Updating Password...</span>
                    </>
                  ) : (
                    <span>Update Password</span>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Legal & Policies */}
          <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#23055c]" />
              <span>Legal & Policies</span>
            </h2>
            <div className="divide-y divide-slate-100">
              <Link
                href="/terms"
                className="py-3 flex items-center justify-between text-xs font-semibold text-slate-700 hover:text-[#23055c] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span>Terms of Service</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
              <Link
                href="/privacy"
                className="py-3 flex items-center justify-between text-xs font-semibold text-slate-700 hover:text-[#23055c] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Shield className="w-4 h-4 text-slate-400" />
                  <span>Privacy Policy & NDPR</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
            </div>
          </div>

          {/* Danger Zone: Account Deactivation */}
          <div className="bg-rose-50/60 rounded-3xl border border-rose-200/80 p-5 sm:p-6 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <h2 className="text-sm font-bold">Danger Zone</h2>
            </div>
            <p className="text-xs text-rose-700/80 leading-relaxed">
              Deactivating your account will immediately revoke all active
              sessions, release unconfirmed holds, and forfeit any remaining
              coin balances.
            </p>
            <button
              type="button"
              onClick={() => {
                setDeactivateError(null);
                setOtpSentMessage(null);
                setDeactivatePassword("");
                setDeactivateOtp("");
                setDeactivateConfirmed(false);
                setShowDeactivateModal(true);
              }}
              className="w-full py-2.5 bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Deactivate Account</span>
            </button>
          </div>

          {/* Logout Action Button */}
          <div>
            <button
              type="button"
              onClick={() => setShowLogoutModal(true)}
              className="w-full py-3.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 font-bold text-xs rounded-2xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
            >
              <LogOut className="w-4 h-4 text-rose-600" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-slate-900">
                Log Out of Account?
              </h3>
              <p className="text-xs text-slate-500">
                Are you sure you want to log out? You will need your email and
                password to sign back in.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                disabled={isLoggingOut}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                disabled={isLoggingOut}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isLoggingOut ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Logging out...</span>
                  </>
                ) : (
                  <span>Yes, Log Out</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Avatar Confirmation Modal */}
      {showDeleteAvatarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-slate-900">
                Remove Profile Picture?
              </h3>
              <p className="text-xs text-slate-500">
                Are you sure you want to remove your profile picture? Your
                initials will be displayed instead.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteAvatarModal(false)}
                disabled={isUploadingAvatar}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleDeleteAvatar();
                  setShowDeleteAvatarModal(false);
                }}
                disabled={isUploadingAvatar}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isUploadingAvatar ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <span>Yes, Remove</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar Cropper Modal */}
      <AvatarCropperModal
        isOpen={isCropperOpen}
        imageSrc={rawImageSrc}
        isUploading={isUploadingAvatar}
        onClose={() => {
          setIsCropperOpen(false);
          setRawImageSrc(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
        onCropComplete={handleCropComplete}
      />

      {/* Deactivate Account Modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-100 space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-rose-600" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-slate-900">
                  Deactivate Your Account
                </h3>
                <p className="text-xs text-slate-500">
                  This action disables your DAIH access. Any unspent coins will
                  be forfeited.
                </p>
              </div>
            </div>

            {deactivateError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{deactivateError}</span>
              </div>
            )}

            {otpSentMessage && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{otpSentMessage}</span>
              </div>
            )}

            <form onSubmit={handleConfirmDeactivation} className="space-y-4">
              {/* Auth Mode Toggle if user has password */}
              {user?.hasPassword !== false && (
                <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-bold text-slate-600">
                  <button
                    type="button"
                    onClick={() => setDeactivateAuthMethod("password")}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      deactivateAuthMethod === "password"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    Confirm with Password
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeactivateAuthMethod("otp");
                      if (!otpSentMessage && !isSendingDeactOtp) {
                        handleRequestDeactivateOtp();
                      }
                    }}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      deactivateAuthMethod === "otp"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    Confirm with Email OTP
                  </button>
                </div>
              )}

              {deactivateAuthMethod === "password" &&
              user?.hasPassword !== false ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Account Password
                  </label>
                  <input
                    type="password"
                    required
                    value={deactivatePassword}
                    onChange={(e) => setDeactivatePassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700">
                      6-Digit Security Code
                    </label>
                    <button
                      type="button"
                      disabled={isSendingDeactOtp}
                      onClick={handleRequestDeactivateOtp}
                      className="text-[11px] font-bold text-[#23055c] hover:underline disabled:opacity-50"
                    >
                      {isSendingDeactOtp ? "Sending code..." : "Resend Code"}
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={deactivateOtp}
                    onChange={(e) => setDeactivateOtp(e.target.value)}
                    placeholder="Enter 6-digit OTP from email"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono font-bold tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all text-center"
                  />
                </div>
              )}

              {/* Optional Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Reason for leaving (Optional)
                </label>
                <select
                  value={deactivateReason}
                  onChange={(e) => setDeactivateReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all"
                >
                  <option value="">Select a reason...</option>
                  <option value="Temporary break">
                    Taking a temporary break
                  </option>
                  <option value="Relocating">Relocating out of area</option>
                  <option value="No longer need workspace">
                    No longer need workspace
                  </option>
                  <option value="Switching to another provider">
                    Switching to another provider
                  </option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Confirmation Checkbox */}
              <div className="pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deactivateConfirmed}
                    onChange={(e) => setDeactivateConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-xs text-slate-600 font-medium leading-tight">
                    I understand that all active sessions will be terminated,
                    any remaining coin balance will be forfeited, and
                    reactivation requires contacting Support.
                  </span>
                </label>
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowDeactivateModal(false)}
                  disabled={isDeactivating}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !deactivateConfirmed ||
                    isDeactivating ||
                    (deactivateAuthMethod === "password" &&
                      !deactivatePassword) ||
                    (deactivateAuthMethod === "otp" &&
                      deactivateOtp.length !== 6)
                  }
                  className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isDeactivating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deactivating...</span>
                    </>
                  ) : (
                    <span>Confirm Closure</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
