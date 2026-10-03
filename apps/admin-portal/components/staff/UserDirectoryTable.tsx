"use client";

import React, { useState } from "react";
import { UserRole } from "@daih/types";
import {
  Edit2,
  Ban,
  CheckCircle,
  Send,
  Shield,
  ChevronLeft,
  ChevronRight,
  User as UserIcon,
  Maximize2,
} from "lucide-react";
import { UserPhotoModal } from "../common/UserPhotoModal";

export interface AdminUserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "ACTIVE" | "PENDING" | "DEACTIVATED";
  lastActive: string;
  avatarUrl?: string | null;
  phone?: string | null;
}

interface UserDirectoryTableProps {
  users: AdminUserRecord[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onEditUser: (user: AdminUserRecord) => void;
  onToggleStatus: (userId: string) => void;
  onResendInvite: (user: AdminUserRecord) => void;
}

export const UserDirectoryTable: React.FC<UserDirectoryTableProps> = ({
  users,
  totalCount,
  currentPage,
  pageSize,
  isLoading = false,
  onPageChange,
  onEditUser,
  onToggleStatus,
  onResendInvite,
}) => {
  const [previewUserPhoto, setPreviewUserPhoto] = useState<{
    name: string;
    email?: string;
    photoUrl: string;
    role?: string;
  } | null>(null);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const startCount = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endCount = Math.min(currentPage * pageSize, totalCount);

  const getRoleBadgeStyle = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return "bg-[#392271] text-white border border-[#392271]";
      case UserRole.OPERATIONS_ADMIN:
        return "bg-[#ffdcc0] text-[#673d12] border border-[#f7ba84]";
      case UserRole.FINANCE_OFFICER:
        return "bg-[#e5e8ee] text-[#494550] border border-[#d7dadf]";
      case UserRole.RECEPTION_OFFICER:
        return "bg-[#e8ddff] text-[#210558] border border-[#cebdff]";
      case UserRole.SECURITY_OFFICER:
        return "bg-blue-100 text-blue-800 border border-blue-200";
      case UserRole.MANAGEMENT_VIEWER:
        return "bg-indigo-100 text-indigo-800 border border-indigo-200";
      default:
        return "bg-slate-100 text-slate-700 border border-slate-200";
    }
  };

  const getRoleDisplayName = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return "Super Admin";
      case UserRole.OPERATIONS_ADMIN:
        return "Operations";
      case UserRole.FINANCE_OFFICER:
        return "Finance";
      case UserRole.RECEPTION_OFFICER:
        return "Reception";
      case UserRole.SECURITY_OFFICER:
        return "Security";
      case UserRole.MANAGEMENT_VIEWER:
        return "Management (CEO)";
      default:
        return role;
    }
  };

  const getStatusBadge = (status: AdminUserRecord["status"]) => {
    switch (status) {
      case "ACTIVE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        );
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Pending Invite
          </span>
        );
      case "DEACTIVATED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Deactivated
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#EBE7F5] shadow-xs overflow-hidden">
      {/* Staff Photo Preview Modal */}
      <UserPhotoModal
        isOpen={Boolean(previewUserPhoto)}
        onClose={() => setPreviewUserPhoto(null)}
        photoUrl={previewUserPhoto?.photoUrl}
        userName={previewUserPhoto?.name || "Staff Photo"}
        userEmail={previewUserPhoto?.email}
        userRole={previewUserPhoto?.role}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#EBE7F5] bg-[#FAF9FF] text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="py-3.5 px-6">User / Staff</th>
              <th className="py-3.5 px-6">Role</th>
              <th className="py-3.5 px-6">Status</th>
              <th className="py-3.5 px-6">Last Active</th>
              <th className="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EBE7F5] text-xs">
            {isLoading ? (
              Array.from({ length: pageSize || 5 }).map((_, idx) => (
                <tr
                  key={idx}
                  className="border-b border-slate-100 animate-pulse"
                >
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3.5 bg-slate-200 rounded w-28" />
                        <div className="h-2.5 bg-slate-100 rounded w-40" />
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <div className="h-5 bg-slate-200 rounded-full w-24" />
                  </td>
                  <td className="py-4 px-6">
                    <div className="h-5 bg-slate-200 rounded-full w-16" />
                  </td>
                  <td className="py-4 px-6">
                    <div className="h-3.5 bg-slate-200 rounded w-20" />
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="h-8 bg-slate-100 rounded-lg w-16 ml-auto" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-400">
                  <UserIcon className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  No staff accounts found matching filter.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-[#F8F9FA] transition-colors group"
                >
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      {user.avatarUrl ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewUserPhoto({
                              name: user.name,
                              email: user.email,
                              photoUrl: user.avatarUrl!,
                              role: getRoleDisplayName(user.role),
                            });
                          }}
                          className="w-10 h-10 rounded-full overflow-hidden border border-[#EBE7F5] shrink-0 hover:ring-2 hover:ring-[#23055c] transition-all cursor-pointer group/avatar relative"
                          title={`Click to view ${user.name}'s photo`}
                        >
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity">
                            <Maximize2 className="w-3.5 h-3.5 text-white" />
                          </div>
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[#e8ddff] text-[#210558] font-bold text-xs flex items-center justify-center border border-[#cebdff] shrink-0">
                          {user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate">
                          {user.name}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Role Badge */}
                  <td className="py-4 px-6">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleBadgeStyle(
                        user.role,
                      )}`}
                    >
                      {getRoleDisplayName(user.role)}
                    </span>
                  </td>

                  {/* Status Pill */}
                  <td className="py-4 px-6">
                    {user.status === "ACTIVE" && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    )}
                    {user.status === "PENDING" && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Pending
                      </span>
                    )}
                    {user.status === "DEACTIVATED" && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        Deactivated
                      </span>
                    )}
                  </td>

                  {/* Last Active */}
                  <td className="py-4 px-6 text-slate-500 hidden md:table-cell text-xs">
                    {user.lastActive}
                  </td>

                  {/* Actions (with hover reveal + keyboard accessibility) */}
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end gap-1.5 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                      {user.status === "PENDING" && (
                        <button
                          onClick={() => onResendInvite(user)}
                          title="Resend Invite"
                          className="p-1.5 text-slate-500 hover:text-[#23055c] transition-colors rounded-lg hover:bg-white shadow-xs border border-transparent hover:border-[#EBE7F5] cursor-pointer"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={() => onEditUser(user)}
                        title="Edit User"
                        className="p-1.5 text-slate-500 hover:text-[#23055c] transition-colors rounded-lg hover:bg-white shadow-xs border border-transparent hover:border-[#EBE7F5] cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onToggleStatus(user.id)}
                        title={
                          user.status === "DEACTIVATED"
                            ? "Activate User"
                            : "Deactivate User"
                        }
                        className={`p-1.5 transition-colors rounded-lg hover:bg-white shadow-xs border border-transparent hover:border-[#EBE7F5] cursor-pointer ${
                          user.status === "DEACTIVATED"
                            ? "text-emerald-600 hover:text-emerald-700"
                            : "text-slate-400 hover:text-rose-600"
                        }`}
                      >
                        {user.status === "DEACTIVATED" ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <Ban className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-6 py-4 border-t border-[#EBE7F5] bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">
          Showing <span className="font-bold text-slate-800">{startCount}</span>{" "}
          to <span className="font-bold text-slate-800">{endCount}</span> of{" "}
          <span className="font-bold text-slate-800">{totalCount}</span> users
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className={`px-3 py-1.5 border border-[#EBE7F5] rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
              currentPage <= 1
                ? "text-slate-300 bg-[#F8F9FA] cursor-not-allowed"
                : "text-slate-700 bg-white hover:bg-[#F8F9FA] cursor-pointer"
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev
          </button>

          <span className="text-xs font-bold text-slate-700 px-2">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className={`px-3 py-1.5 border border-[#EBE7F5] rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
              currentPage >= totalPages
                ? "text-slate-300 bg-[#F8F9FA] cursor-not-allowed"
                : "text-slate-700 bg-white hover:bg-[#F8F9FA] cursor-pointer"
            }`}
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
