"use client";

/**
 * Higher-order component that renders the wrapped component
 * only when the current user has one of the allowed roles.
 *
 * Usage:
 *   const AdminPanel = withRoleProtection(Panel, ["admin"]);
 *   // <AdminPanel /> renders nothing for non-admin users.
 */

import React from "react";
import { useAuthStore } from "@/store/auth";
import { getUserRole, type UserRole } from "@/lib/roles";

export function withRoleProtection<P extends object>(
  Component: React.ComponentType<P>,
  allowedRoles: UserRole[],
) {
  function ProtectedComponent(props: P) {
    const { user } = useAuthStore();
    const role = getUserRole(user);

    if (!allowedRoles.includes(role)) return null;

    return <Component {...props} />;
  }

  ProtectedComponent.displayName = `withRoleProtection(${Component.displayName || Component.name || "Component"})`;

  return ProtectedComponent;
}
