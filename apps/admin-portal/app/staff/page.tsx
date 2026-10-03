"use client";

import React, { useState, useEffect, useMemo } from "react";
import { UserRole, UserProfile } from "@daih/types";
import { api } from "@daih/api-client";
import { UserPlus, CheckCircle2, AlertCircle } from "lucide-react";
import {
  UserMetricsGrid,
  UserDirectoryToolbar,
  UserDirectoryTable,
  AddStaffModal,
  EditStaffModal,
  AdminUserRecord,
} from "../../components/staff";

export default function StaffManagementPage() {
  const [staffList, setStaffList] = useState<AdminUserRecord[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  const [isAddStaffModalOpen, setIsAddStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<AdminUserRecord | null>(
    null,
  );
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Fetch real staff users from backend API
  useEffect(() => {
    let isMounted = true;
    (async () => {
      setIsLoadingStaff(true);
      try {
        const users = await api.auth.getStaffUsers();
        if (isMounted) {
          if (users && Array.isArray(users)) {
            const mapped: AdminUserRecord[] = users.map((u: UserProfile) => ({
              id: u.id || u.clientId,
              name:
                `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
              email: u.email,
              phone: u.phoneNumber,
              role: u.role as UserRole,
              status: u.isVerified ? "ACTIVE" : "PENDING",
              lastActive: u.isVerified
                ? "Active on Console"
                : "Pending Activation",
            }));
            setStaffList(mapped);
          } else {
            setStaffList([]);
          }
        }
      } catch (err: any) {
        console.warn("Could not load live staff list from backend:", err);
        if (isMounted) {
          setStaffList([]);
          showToast(
            "Could not load staff list from server. Please verify your connection.",
            "error",
          );
        }
      } finally {
        if (isMounted) setIsLoadingStaff(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Metrics computation
  const totalAdmins = staffList.length;
  const activeNow = staffList.filter((u) => u.status === "ACTIVE").length;
  const pendingInvites = staffList.filter((u) => u.status === "PENDING").length;

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    return staffList.filter((u) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = u.name.toLowerCase().includes(q);
        const matchesEmail = u.email.toLowerCase().includes(q);
        const matchesRole = u.role.toLowerCase().includes(q);
        if (!matchesName && !matchesEmail && !matchesRole) return false;
      }

      if (roleFilter !== "ALL") {
        if (u.role !== roleFilter) return false;
      }

      if (statusFilter !== "ALL") {
        if (u.status !== statusFilter) return false;
      }

      return true;
    });
  }, [staffList, searchQuery, roleFilter, statusFilter]);

  // Paginated staff
  const paginatedStaff = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredStaff.slice(start, start + pageSize);
  }, [filteredStaff, currentPage, pageSize]);

  const handleAddStaff = async (newStaffData: {
    name: string;
    email: string;
    phone?: string;
    role: UserRole;
  }) => {
    const parts = newStaffData.name.trim().split(/\s+/);
    const firstName = parts[0] || "Staff";
    const lastName = parts.slice(1).join(" ") || "Member";

    // Call backend API to persist staff user to database and trigger setup email
    const createdUser = await api.auth.createStaffUser({
      firstName,
      lastName,
      email: newStaffData.email,
      phoneNumber: newStaffData.phone,
      role: newStaffData.role,
    });

    const newStaff: AdminUserRecord = {
      id: (createdUser as any).id || (createdUser as any).clientId,
      name: `${(createdUser as any).firstName || firstName} ${(createdUser as any).lastName || lastName}`.trim(),
      email: (createdUser as any).email || newStaffData.email,
      phone: (createdUser as any).phoneNumber || newStaffData.phone,
      role: ((createdUser as any).role || newStaffData.role) as UserRole,
      status: "PENDING",
      lastActive: "Invitation Sent",
    };

    setStaffList((prev) => [newStaff, ...prev]);
    showToast(
      `Admin account created. A secure 1-hour setup link was sent to ${newStaffData.email}`,
    );
  };

  const handleUpdateStaff = async (updatedStaff: AdminUserRecord) => {
    const parts = updatedStaff.name.trim().split(/\s+/);
    const firstName = parts[0] || "Staff";
    const lastName = parts.slice(1).join(" ") || "Member";

    try {
      const result = await api.adminUsers.updateStaffUser(updatedStaff.id, {
        firstName,
        lastName,
        phoneNumber: updatedStaff.phone || undefined,
        role: updatedStaff.role,
        isVerified: updatedStaff.status === "ACTIVE",
      });

      setStaffList((prev) =>
        prev.map((u) =>
          u.id === updatedStaff.id
            ? {
                ...updatedStaff,
                role: (result.role || updatedStaff.role) as UserRole,
                status: result.isVerified ? "ACTIVE" : updatedStaff.status,
              }
            : u,
        ),
      );
      showToast(
        `Staff role and details updated successfully for ${updatedStaff.name}`,
      );
    } catch (err: any) {
      showToast(
        err?.message || "Failed to update staff record in database",
        "error",
      );
      throw err;
    }
  };

  const handleToggleStatus = async (staffId: string) => {
    const target = staffList.find((u) => u.id === staffId);
    if (!target) return;
    const nextStatus =
      target.status === "DEACTIVATED" ? "ACTIVE" : "DEACTIVATED";

    try {
      await api.adminUsers.updateStaffUser(staffId, {
        isVerified: nextStatus === "ACTIVE",
      });

      setStaffList((prev) =>
        prev.map((u) => (u.id === staffId ? { ...u, status: nextStatus } : u)),
      );
      showToast(
        `Staff access for ${target.name} has been ${
          nextStatus === "ACTIVE" ? "restored" : "deactivated"
        }`,
      );
    } catch (err: any) {
      showToast(
        err?.message || "Failed to update staff status in database",
        "error",
      );
    }
  };

  const handleResendInvite = async (staff: AdminUserRecord) => {
    try {
      await api.adminUsers.resendSetupLink(staff.id);
      showToast(`Fresh 1-hour setup invitation link sent to ${staff.email}`);
    } catch (err: any) {
      showToast(err?.message || "Failed to resend setup invitation", "error");
    }
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
    setCurrentPage(1);
  };

  const handleFilterPending = () => {
    setStatusFilter("PENDING");
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-[1280px] mx-auto pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-20 right-6 z-50 p-4 rounded-2xl text-white shadow-xl flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-200 ${
            toastMessage.type === "error" ? "bg-rose-700" : "bg-[#23055c]"
          }`}
        >
          {toastMessage.type === "error" ? (
            <AlertCircle className="w-4 h-4 text-rose-200 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Staff Onboarding & Access
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Onboard new staff members, provision administrative credentials, and
            manage operational roles
          </p>
        </div>

        <button
          onClick={() => setIsAddStaffModalOpen(true)}
          className="bg-[#23055c] text-white text-xs font-bold px-6 py-3 rounded-xl hover:bg-[#392271] transition-all shadow-sm flex items-center gap-2 whitespace-nowrap active:scale-95 cursor-pointer shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Onboard New Staff</span>
        </button>
      </div>

      {/* Bento Grid Overview Cards */}
      <UserMetricsGrid
        totalAdmins={totalAdmins}
        activeNow={activeNow}
        pendingInvites={pendingInvites}
        onFilterPending={handleFilterPending}
      />

      {/* User Table Card */}
      <div className="bg-white rounded-2xl border border-[#EBE7F5] shadow-[0px_4px_12px_rgba(33,37,41,0.05)] overflow-hidden flex flex-col">
        {/* Toolbar */}
        <UserDirectoryToolbar
          searchQuery={searchQuery}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setCurrentPage(1);
          }}
          roleFilter={roleFilter}
          onRoleFilterChange={(r) => {
            setRoleFilter(r);
            setCurrentPage(1);
          }}
          statusFilter={statusFilter}
          onStatusFilterChange={(s) => {
            setStatusFilter(s);
            setCurrentPage(1);
          }}
          onResetFilters={handleResetFilters}
        />

        {/* Table with Pagination */}
        <UserDirectoryTable
          users={paginatedStaff}
          totalCount={filteredStaff.length}
          currentPage={currentPage}
          pageSize={pageSize}
          isLoading={isLoadingStaff}
          onPageChange={setCurrentPage}
          onEditUser={(u) => setEditingStaff(u)}
          onToggleStatus={handleToggleStatus}
          onResendInvite={handleResendInvite}
        />
      </div>

      {/* Add Staff Modal */}
      <AddStaffModal
        isOpen={isAddStaffModalOpen}
        onClose={() => setIsAddStaffModalOpen(false)}
        onStaffAdded={handleAddStaff}
      />

      {/* Edit Staff Modal */}
      <EditStaffModal
        isOpen={!!editingStaff}
        staff={editingStaff}
        onClose={() => setEditingStaff(null)}
        onStaffUpdated={handleUpdateStaff}
      />
    </div>
  );
}
