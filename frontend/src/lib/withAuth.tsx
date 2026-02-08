"use client";

/**
 * Higher-order component that ensures the user is authenticated.
 * Uses the global loader while checking auth.
 * If the user is not authenticated it redirects to /login.
 *
 * Usage:
 *   export default withAuth(SettingsPage);
 */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { useLoader } from "@/hooks/useLoader";

export function withAuth<P extends object>(Component: React.ComponentType<P>) {
  function AuthenticatedComponent(props: P) {
    const { isAuthenticated, fetchUser } = useAuthStore();
    const { setLoading } = useLoader();
    const router = useRouter();
    const [checked, setChecked] = useState(false);

    useEffect(() => {
      const check = async () => {
        setLoading(true, "Checking authentication...");
        await fetchUser();
        setChecked(true);
        setLoading(false);
      };
      check();
    }, [fetchUser, setLoading]);

    useEffect(() => {
      if (checked && !isAuthenticated) {
        router.replace("/login");
      }
    }, [checked, isAuthenticated, router]);

    // Don't render anything while checking - global loader handles it
    if (!checked) return null;

    if (!isAuthenticated) return null;

    return <Component {...props} />;
  }

  AuthenticatedComponent.displayName = `withAuth(${Component.displayName || Component.name || "Component"})`;

  return AuthenticatedComponent;
}
