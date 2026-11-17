"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  Shield,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Loader2,
} from "lucide-react";
import { useAuth } from "@daih/api-client";
import { Modal } from "@daih/ui";
import { hasRouteAccess } from "../../lib/rbac";

export interface AdminHeaderProps {
  isMobileOpen: boolean;
  onMobileToggle: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  isMobileOpen,
  onMobileToggle,
  isCollapsed,
  onToggleCollapse,
}) => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      window.location.href = "/login";
    } catch {
      window.location.href = "/login";
    }
  };

  interface PageBreadcrumb {
    parent?: { title: string; href: string };
    current: string;
  }

  const getBreadcrumb = (path: string): PageBreadcrumb => {
    if (path === "/" || path === "") {
      return { current: "Dashboard" };
    }
    if (path === "/bookings") {
      return { current: "Bookings" };
    }
    if (path.startsWith("/bookings/")) {
      return {
        parent: { title: "Bookings", href: "/bookings" },
        current: "Booking Details",
      };
    }
    if (
      path === "/operations/campaigns" ||
      path.startsWith("/operations/campaigns")
    ) {
      return {
        parent: { title: "Operations", href: "/operations" },
        current: "Campaigns & Growth AI",
      };
    }
    if (path === "/operations" || path === "/operations/resources") {
      return { current: "Resources & Spaces" };
    }
    if (path.startsWith("/operations/")) {
      return {
        parent: { title: "Resources", href: "/operations" },
        current: "Space Details",
      };
    }
    if (path === "/customers") {
      return { current: "Customers" };
    }
    if (path.startsWith("/customers/")) {
      return {
        parent: { title: "Customers", href: "/customers" },
        current: "Member Profile",
      };
    }
    if (path === "/finance/refunds" || path.startsWith("/finance/refunds")) {
      return {
        parent: { title: "Finance", href: "/finance" },
        current: "Refund Approvals",
      };
    }
    if (
      path === "/finance/transfers" ||
      path.startsWith("/finance/transfers/")
    ) {
      return {
        parent: { title: "Finance", href: "/finance" },
        current: "Bank Transfers",
      };
    }
    if (path === "/finance") {
      return { current: "Finance & Payments" };
    }
    if (path.startsWith("/finance/")) {
      return {
        parent: { title: "Finance", href: "/finance" },
        current: "Transaction Details",
      };
    }
    if (path === "/reports") {
      return { current: "Reports & Analytics" };
    }
    if (path === "/visits") {
      return { current: "Front Desk & Visits" };
    }
    if (path === "/staff" || path.startsWith("/users")) {
      return { current: "Staff Management" };
    }
    if (path === "/profile" || path.startsWith("/profile")) {
      return {
        parent: { title: "Dashboard", href: "/" },
        current: "Admin Profile",
      };
    }
    if (path === "/settings") {
      return { current: "Settings" };
    }
    if (path === "/settings/policies") {
      return {
        parent: { title: "Settings", href: "/settings" },
        current: "Terms & Privacy Policies",
      };
    }
    if (path === "/settings/support") {
      return {
        parent: { title: "Settings", href: "/settings" },
        current: "Support & FAQs",
      };
    }
    if (path === "/settings/email-templates") {
      return {
        parent: { title: "Settings", href: "/settings" },
        current: "Email Templates",
      };
    }
    if (path === "/settings/payments") {
      return {
        parent: { title: "Settings", href: "/settings" },
        current: "Payment Methods",
      };
    }
    if (path.startsWith("/settings/")) {
      return {
        parent: { title: "Settings", href: "/settings" },
        current: "Configuration",
      };
    }
    if (path.startsWith("/login")) {
      return { current: "Admin Authentication" };
    }
    return { current: "Admin Console" };
  };

  const breadcrumb = getBreadcrumb(pathname);
  // Only link to a parent page the signed-in role can open (finance and
  // management may view Payment Methods but not the Settings home).
  const breadcrumbParent =
    breadcrumb.parent && hasRouteAccess(user?.role, breadcrumb.parent.href)
      ? breadcrumb.parent
      : undefined;

  return (
    <header className="bg-white/95 backdrop-blur-md fixed top-0 w-full z-50 flex justify-between items-center px-4 sm:px-6 lg:px-8 py-3 border-b border-[#EBE7F5] shadow-xs">
      {/* Left: Mobile Toggle & Brand */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          onClick={onMobileToggle}
          className="lg:hidden text-[#23055c] p-2 rounded-xl hover:bg-slate-100 transition-colors border border-slate-200 cursor-pointer"
          aria-label="Toggle Navigation Menu"
        >
          {isMobileOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>

        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex items-center justify-center text-[#23055c] p-2 rounded-xl hover:bg-slate-100 transition-all border border-slate-200 cursor-pointer"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-4 h-4 text-[#23055c]" />
          ) : (
            <PanelLeftClose className="w-4 h-4 text-[#23055c]" />
          )}
        </button>

        <Link href="/" className="flex items-center gap-2.5">
          <img
            src="/images/logo.png"
            alt="DAIH Workspace Logo"
            className="h-8 w-auto object-contain"
          />
          <span className="font-extrabold text-base sm:text-lg text-[#23055c] tracking-tight hidden sm:inline-block">
            DAIH Admin
          </span>
        </Link>

        {/* Current Active Page Breadcrumb / Title */}
        <div className="hidden md:flex items-center gap-2 border-l border-slate-200 pl-4 py-0.5">
          {breadcrumbParent ? (
            <>
              <Link
                href={breadcrumbParent.href}
                className="text-xs font-semibold text-slate-500 hover:text-[#23055c] transition-colors"
              >
                {breadcrumbParent.title}
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-xs font-bold text-slate-800">
                {breadcrumb.current}
              </span>
            </>
          ) : (
            <span className="text-xs font-bold text-slate-800">
              {breadcrumb.current}
            </span>
          )}
        </div>
      </div>

      {/* Right: Status & Quick Controls */}
      <div className="flex items-center gap-2.5 sm:gap-3.5">
        {/* Live Operations Indicator */}
        <div className="flex items-center gap-2 bg-[#F8F9FA] px-3 py-1.5 rounded-full border border-[#EBE7F5] text-xs font-semibold text-slate-700 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
          <span className="hidden xs:inline">Live Operations Active</span>
          <span className="xs:hidden">Live</span>
        </div>

        {/* Customer PWA Quick Link */}
        <a
          href={
            process.env.NEXT_PUBLIC_CUSTOMER_PWA_URL || "http://localhost:3001"
          }
          target="_blank"
          rel="noreferrer"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold transition-colors shadow-xs"
          title="Open Customer PWA"
        >
          <span>Customer PWA</span>
          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
        </a>

        {/* User Role Pill & Profile Link */}
        <Link
          href="/profile"
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 text-[#23055c] text-[11px] font-bold transition-all cursor-pointer shadow-2xs"
          title="View & Edit Admin Profile"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>{user?.role || "OPERATIONS_ADMIN"}</span>
        </Link>

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={() => setShowLogoutModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-slate-600 hover:text-rose-600 text-xs font-semibold transition-all cursor-pointer shadow-xs"
          title="Sign Out of Admin Console"
        >
          <LogOut className="w-3.5 h-3.5 text-rose-500" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>

      {/* Sign Out Confirmation Modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => !isLoggingOut && setShowLogoutModal(false)}
        title="Sign Out of Admin Console"
      >
        <div className="space-y-4">
          <p className="text-xs sm:text-sm text-slate-600">
            Are you sure you want to end your administrator session? You will
            need your credentials to log back in.
          </p>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowLogoutModal(false)}
              disabled={isLoggingOut}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="px-4 py-2 rounded-xl bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              {isLoggingOut ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing Out...</span>
                </>
              ) : (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Confirm Sign Out</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </header>
  );
};
