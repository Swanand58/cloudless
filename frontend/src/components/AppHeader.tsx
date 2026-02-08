"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { Lock, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";

interface AppHeaderProps {
  /** Optional breadcrumb text shown after the logo separator */
  breadcrumb?: React.ReactNode;
  /** Width class for the inner container (default: w-full) */
  maxWidth?: string;
}

export function AppHeader({ breadcrumb, maxWidth = "w-full" }: AppHeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  return (
    <header className="bg-card border-b border-border">
      <div className={`${maxWidth} px-6 lg:px-12 py-3 flex items-center justify-between`}>
        {/* Left: logo */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="p-1.5 bg-primary rounded-lg">
              <Lock className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Cloudless</span>
          </Link>

          {breadcrumb && (
            <>
              <Separator orientation="vertical" className="h-6" />
              <div className="text-sm text-muted-foreground">{breadcrumb}</div>
            </>
          )}
        </div>

        {/* Right: user actions + theme toggle */}
        <div className="flex items-center gap-3">
          {user && (
            <>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user.display_name}
              </span>
              <Button variant="ghost" size="icon" onClick={() => router.push("/settings")} aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={logout}>
                <LogOut className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Sign Out</span>
              </Button>
              <Separator orientation="vertical" className="h-6" />
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
