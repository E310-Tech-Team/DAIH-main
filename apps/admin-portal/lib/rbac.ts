import { Permission, ROLE_PERMISSIONS, UserRole } from "@daih/types";

export interface NavSubItem {
  name: string;
  href: string;
}

export interface NavItemConfig {
  name: string;
  href: string;
  icon: any;
  description: string;
  badge?: string;
  requiredPermissions?: Permission[];
  requiredRoles?: UserRole[];
  subItems?: NavSubItem[];
}

export interface NavSectionConfig {
  title: string;
  items: NavItemConfig[];
}

/**
 * Super admins (and the legacy "ADMIN" role) can open every page and do everything.
 */
export function isSuperAdminRole(role?: UserRole | string | null): boolean {
  if (!role) return false;
  const rawRole = role.toString().toUpperCase();
  return rawRole === UserRole.SUPER_ADMIN || rawRole === "ADMIN";
}

/**
 * Returns all permissions associated with a user role.
 */
export function getUserPermissions(
  role?: UserRole | string | null,
): Permission[] {
  if (!role) return [];
  if (isSuperAdminRole(role)) {
    return Object.values(Permission);
  }
  const rawRole = role.toString().toUpperCase();
  const roleKey =
    Object.values(UserRole).find((r) => r.toUpperCase() === rawRole) ||
    (role as UserRole);
  return roleKey && ROLE_PERMISSIONS[roleKey] ? ROLE_PERMISSIONS[roleKey] : [];
}

/**
 * Checks if a user has at least one of the required permissions.
 */
export function hasPermission(
  role?: UserRole | string | null,
  permission?: Permission | Permission[],
): boolean {
  if (!role) return false;
  if (isSuperAdminRole(role)) {
    return true;
  }
  if (!permission) return true;
  const userPerms = getUserPermissions(role);
  const required = Array.isArray(permission) ? permission : [permission];
  return required.some((p) => userPerms.includes(p));
}

/**
 * Validates whether a user role has access to view a specific admin console route.
 */
export function hasRouteAccess(
  role?: UserRole | string | null,
  pathname: string = "/",
): boolean {
  if (!role) return false;
  const rawRole = role.toString().toUpperCase();
  const isSuperAdmin = isSuperAdminRole(role);

  if (isSuperAdmin) {
    return true;
  }

  // Dashboard overview is accessible to all staff
  if (pathname === "/" || pathname === "") {
    return true;
  }

  // Profile page is accessible to all authenticated staff
  if (pathname === "/profile" || pathname.startsWith("/profile")) {
    return true;
  }

  if (pathname.startsWith("/bookings")) {
    return hasPermission(role, [
      Permission.BOOKINGS_READ_ALL,
      Permission.BOOKINGS_MANAGE,
    ]);
  }

  if (pathname.startsWith("/operations")) {
    return (
      rawRole === UserRole.OPERATIONS_ADMIN ||
      hasPermission(role, [
        Permission.RESOURCES_MANAGE,
        Permission.BOOKINGS_OVERRIDE,
      ])
    );
  }

  if (pathname.startsWith("/customers")) {
    return (
      rawRole === UserRole.OPERATIONS_ADMIN ||
      rawRole === UserRole.RECEPTION_OFFICER ||
      hasPermission(role, [Permission.BOOKINGS_READ_ALL])
    );
  }

  // Confirming bank transfers against the bank statement is finance's job
  // (the API requires payments:confirm). Checked before the wider /finance rule.
  if (pathname.startsWith("/finance/transfers")) {
    return (
      rawRole === UserRole.FINANCE_OFFICER ||
      hasPermission(role, Permission.PAYMENTS_CONFIRM)
    );
  }

  if (pathname.startsWith("/finance")) {
    return (
      rawRole === UserRole.FINANCE_OFFICER ||
      rawRole === UserRole.OPERATIONS_ADMIN ||
      hasPermission(role, [
        Permission.PAYMENTS_READ,
        Permission.PAYMENTS_REFUND,
        Permission.BOOKINGS_MANAGE,
      ])
    );
  }

  if (pathname.startsWith("/reports")) {
    return (
      rawRole === UserRole.MANAGEMENT_VIEWER ||
      rawRole === UserRole.FINANCE_OFFICER ||
      rawRole === UserRole.OPERATIONS_ADMIN ||
      hasPermission(role, [Permission.REPORTS_VIEW, Permission.REPORTS_EXPORT])
    );
  }

  if (pathname.startsWith("/visits")) {
    return (
      rawRole === UserRole.RECEPTION_OFFICER ||
      rawRole === UserRole.SECURITY_OFFICER ||
      rawRole === UserRole.OPERATIONS_ADMIN ||
      rawRole === UserRole.MANAGEMENT_VIEWER ||
      hasPermission(role, [
        Permission.BOOKINGS_READ_ALL,
        Permission.REPORTS_VIEW,
      ])
    );
  }

  // Staff membership & management is strictly restricted to SUPER_ADMIN
  if (pathname.startsWith("/staff") || pathname.startsWith("/users")) {
    return isSuperAdmin || hasPermission(role, Permission.USERS_MANAGE);
  }

  // Payment methods: viewable by everyone the API lets read payment settings
  // (payments:read_summary); only a super admin can change them.
  // Checked before the wider /settings rule.
  if (pathname.startsWith("/settings/payments")) {
    return (
      rawRole === UserRole.OPERATIONS_ADMIN ||
      rawRole === UserRole.FINANCE_OFFICER ||
      rawRole === UserRole.MANAGEMENT_VIEWER ||
      hasPermission(role, Permission.PAYMENTS_READ_SUMMARY)
    );
  }

  if (pathname.startsWith("/settings")) {
    return (
      isSuperAdmin ||
      rawRole === UserRole.OPERATIONS_ADMIN ||
      hasPermission(role, Permission.SYSTEM_CONFIG)
    );
  }

  return false;
}
