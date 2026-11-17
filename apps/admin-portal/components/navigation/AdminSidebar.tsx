"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  Layers,
  Users,
  Receipt,
  BarChart3,
  UserCheck,
  Settings,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Shield,
  PanelLeftOpen,
  Tag,
  Coins,
  Star,
  Sparkles,
  RotateCcw,
  User,
  Loader2,
  Landmark,
} from "lucide-react";
import { useAuth } from "@daih/api-client";
import { cn, Modal } from "@daih/ui";
import { resolveAvatarUrl } from "../../lib/image-utils";
import { hasRouteAccess, NavSectionConfig } from "../../lib/rbac";

export interface AdminSidebarProps {
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  isMobileOpen,
  onMobileClose,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [avatarError, setAvatarError] = React.useState(false);

  React.useEffect(() => {
    setAvatarError(false);
  }, [user?.avatarUrl]);

  const resolvedAvatar = resolveAvatarUrl(user?.avatarUrl);

  const navigationSections: NavSectionConfig[] = [
    {
      title: "Operations & Hub",
      items: [
        {
          name: "Dashboard",
          href: "/",
          icon: LayoutDashboard,
          description: "Live floor pulse & overview",
          badge: "Live",
        },
        {
          name: "Bookings",
          href: "/bookings",
          icon: CalendarCheck,
          description: "Reservations, holds & VIP overrides",
        },
        {
          name: "Operations",
          href: "/operations",
          icon: Layers,
          description: "Desks, rooms, holds & capacity",
        },
        {
          name: "Campaigns & AI",
          href: "/operations/campaigns",
          icon: Sparkles,
          description: "6 guardrails, lift analytics & AI copy",
          badge: "AI",
        },
        {
          name: "Customers",
          href: "/customers",
          icon: Users,
          description: "Member directory & Client IDs",
        },
        {
          name: "Check-In / Out Logs",
          href: "/visits",
          icon: UserCheck,
          description: "Facility access & live occupancy logs",
        },
        {
          name: "Customer Reviews",
          href: "/operations/reviews",
          icon: Star,
          description: "Verified testimonials & approvals",
        },
      ],
    },
    {
      title: "Finance & Commerce",
      items: [
        {
          name: "Finance",
          href: "/finance",
          icon: Receipt,
          description: "Paystack ledger & settlements",
        },
        {
          name: "Bank Transfers",
          href: "/finance/transfers",
          icon: Landmark,
          description: "Confirm against the bank statement",
        },
        {
          name: "Refund Approvals",
          href: "/finance/refunds",
          icon: RotateCcw,
          description: "Dual-authorization & coin clawbacks",
          badge: "Dual-Auth",
        },
        {
          name: "Discounts & Promos",
          href: "/finance/discounts",
          icon: Tag,
          description: "Customer coupons & space promotions",
        },
        {
          name: "Loyalty & PD Coins",
          href: "/finance/loyalty",
          icon: Coins,
          description: "Reward formulas & token ledger",
        },
      ],
    },
    {
      title: "Governance & Analytics",
      items: [
        {
          name: "Reports",
          href: "/reports",
          icon: BarChart3,
          description: "Footfall & space analytics",
        },
        {
          name: "Staff Management",
          href: "/staff",
          icon: UserCheck,
          description: "Team directory & RBAC roles",
          badge: "RBAC",
        },
        {
          name: "My Profile",
          href: "/profile",
          icon: User,
          description: "Admin account & credentials",
        },
        {
          name: "Settings",
          href: "/settings",
          icon: Settings,
          description: "Workspace & hub preferences",
        },
      ],
    },
  ];

  // Dynamically filter sections and items according to the logged-in admin's RBAC role and permissions
  const userRole = user?.role;
  const filteredSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        hasRouteAccess(userRole, item.href),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const allNavHrefs = React.useMemo(() => {
    return filteredSections.flatMap((s) => s.items.map((i) => i.href));
  }, [filteredSections]);

  const isItemActive = React.useCallback(
    (href: string) => {
      if (href === "/") {
        return pathname === "/";
      }
      if (pathname === href) {
        return true;
      }
      if (pathname.startsWith(`${href}/`)) {
        const hasMoreSpecific = allNavHrefs.some(
          (otherHref) =>
            otherHref !== href &&
            otherHref.startsWith(href) &&
            (pathname === otherHref || pathname.startsWith(`${otherHref}/`)),
        );
        return !hasMoreSpecific;
      }
      return false;
    },
    [pathname, allNavHrefs],
  );

  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      window.location.href = "/login";
    } catch {
      window.location.href = "/login";
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return "AD";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <aside
      className={cn(
        "fixed lg:sticky top-[65px] left-0 h-[calc(100vh-65px)] bg-white border-r border-[#EBE7F5] z-40 overflow-y-auto flex flex-col justify-between transition-all duration-300 shadow-xs shrink-0",
        isCollapsed ? "w-64 lg:w-20" : "w-64 lg:w-72",
        isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}
    >
      <div
        className={cn(
          "flex-1 transition-all duration-300",
          isCollapsed ? "p-3 lg:p-2.5" : "p-4 sm:p-5",
        )}
      >
        {/* Navigation Categories */}
        <div className="space-y-6">
          {filteredSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1.5">
              {/* Category Header */}
              {isCollapsed ? (
                <div
                  className="hidden lg:block my-2 border-t border-slate-100"
                  title={section.title}
                />
              ) : (
                <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>{section.title}</span>
                </div>
              )}

              {/* Mobile always shows full category header */}
              {isCollapsed && (
                <div className="lg:hidden px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>{section.title}</span>
                </div>
              )}

              <nav className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = isItemActive(item.href);

                  return (
                    <div key={item.href} className="space-y-0.5">
                      <Link
                        href={item.href}
                        onClick={onMobileClose}
                        title={
                          isCollapsed
                            ? `${item.name} — ${item.description}`
                            : undefined
                        }
                        className={cn(
                          "flex items-center gap-3 rounded-xl text-xs transition-all group relative",
                          isCollapsed
                            ? "px-3 py-2.5 lg:px-2 lg:py-2.5 lg:justify-center"
                            : "px-3 py-2.5",
                          isActive
                            ? "bg-[#392271] text-white font-bold shadow-sm"
                            : "text-slate-600 hover:bg-[#F8F9FA] hover:text-[#23055c]",
                        )}
                      >
                        <div
                          className={cn(
                            "p-1.5 rounded-lg shrink-0 transition-colors",
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-purple-50 text-[#23055c] group-hover:bg-purple-100",
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </div>

                        {/* Text and metadata (hidden on collapsed desktop) */}
                        <div
                          className={cn(
                            "min-w-0 flex-1 transition-opacity duration-200",
                            isCollapsed ? "lg:hidden" : "block",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate">{item.name}</span>
                            {item.badge && (
                              <span
                                className={cn(
                                  "text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shrink-0",
                                  isActive
                                    ? "bg-white/25 text-white"
                                    : "bg-purple-100 text-[#23055c]",
                                )}
                              >
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <div
                            className={cn(
                              "text-[10px] truncate font-normal",
                              isActive ? "text-white/75" : "text-slate-400",
                            )}
                          >
                            {item.description}
                          </div>
                        </div>
                      </Link>

                      {/* Sub-items (shown when expanded and active) */}
                      {isActive &&
                        item.subItems &&
                        item.subItems.length > 0 && (
                          <div
                            className={cn(
                              "pl-9 pr-2 py-1 space-y-0.5 border-l-2 border-purple-100 ml-5 my-1",
                              isCollapsed ? "lg:hidden" : "block",
                            )}
                          >
                            {item.subItems.map((sub, subIdx) => (
                              <Link
                                key={subIdx}
                                href={sub.href}
                                onClick={onMobileClose}
                                className="flex items-center justify-between py-1 px-2 text-[11px] font-medium text-slate-500 hover:text-[#23055c] hover:bg-purple-50/50 rounded-md transition-colors"
                              >
                                <span>{sub.name}</span>
                                <ChevronRight className="w-3 h-3 text-slate-300" />
                              </Link>
                            ))}
                          </div>
                        )}
                    </div>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* User Info & Collapse Controls Footer */}
      <div
        className={cn(
          "border-t border-[#EBE7F5] bg-[#F8F9FA] space-y-2",
          isCollapsed ? "p-3 lg:p-2" : "p-4",
        )}
      >
        {/* User Card */}
        <div
          className={cn(
            "flex items-center gap-3",
            isCollapsed ? "lg:justify-center" : "",
          )}
        >
          <Link
            href="/profile"
            onClick={onMobileClose}
            className="flex items-center gap-3 flex-1 min-w-0 group hover:opacity-90 transition-opacity"
            title="View Admin Profile"
          >
            <div
              className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#23055c] to-[#65519f] text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs cursor-pointer overflow-hidden group-hover:ring-2 group-hover:ring-purple-400 transition-all"
              title={
                user
                  ? `${user.firstName} ${user.lastName} (${user.role})`
                  : "Staff Administrator"
              }
            >
              {resolvedAvatar && !avatarError ? (
                <img
                  src={resolvedAvatar}
                  alt={user ? `${user.firstName} ${user.lastName}` : "Admin"}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                getInitials(
                  user ? `${user.firstName} ${user.lastName}` : "Admin",
                )
              )}
            </div>

            <div
              className={cn(
                "min-w-0 flex-1",
                isCollapsed ? "lg:hidden" : "block",
              )}
            >
              <div className="font-bold text-xs text-slate-900 truncate">
                {user
                  ? `${user.firstName} ${user.lastName}`
                  : "Staff Administrator"}
              </div>
              <div className="text-[10px] text-slate-500 truncate flex items-center gap-1">
                <Shield className="w-3 h-3 text-[#23055c]" />
                <span>{user?.role || "OPERATIONS_ADMIN"}</span>
              </div>
            </div>
          </Link>

          <button
            onClick={() => setShowLogoutModal(true)}
            className={cn(
              "p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer",
              isCollapsed ? "lg:hidden" : "block",
            )}
            title="Sign Out of Console"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Desktop Collapse / Expand Toggle Button */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              "hidden lg:flex items-center justify-center w-full py-1.5 px-2 text-slate-400 hover:text-[#23055c] hover:bg-slate-100 rounded-lg text-xs font-semibold transition-all border border-transparent hover:border-slate-200 cursor-pointer",
              isCollapsed ? "mt-1" : "mt-2",
            )}
            title={
              isCollapsed
                ? "Expand Sidebar (Ctrl+B)"
                : "Collapse Sidebar (Ctrl+B)"
            }
          >
            {isCollapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-[#23055c]" />
            ) : (
              <div className="flex items-center justify-between w-full text-[11px] text-slate-500 hover:text-[#23055c]">
                <span>Collapse Navigation</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </div>
            )}
          </button>
        )}
      </div>

      {/* Logout Confirmation Modal */}
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
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="px-4 py-2 rounded-xl bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
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
    </aside>
  );
};
