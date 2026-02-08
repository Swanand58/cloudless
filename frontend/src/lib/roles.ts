/**
 * Role-based access control types and helpers.
 */

import type { UserResponse } from "@/lib/api";

export type UserRole = "admin" | "user";

/**
 * Derive the role from a user object.
 */
export function getUserRole(user: UserResponse | null): UserRole {
  if (!user) return "user";
  return user.is_admin ? "admin" : "user";
}

/**
 * Check whether the user satisfies one of the allowed roles.
 */
export function hasRole(user: UserResponse | null, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(getUserRole(user));
}
