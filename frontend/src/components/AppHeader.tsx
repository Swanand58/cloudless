"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { Lock, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";

interface AppHeaderProps {
  breadcrumb?: React.ReactNode;
  maxWidth?: string;
}

export function AppHeader({ breadcrumb, maxWidth = "w-full" }: AppHeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  return (
    <header className="bg-card border-b border-border">
      <div className={`${maxWidth} px-3 sm:px-6 lg:px-12 py-2 sm:py-3 flex items-center justify-between`}>
        {/* Left: logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="p-1.5 bg-primary rounded-lg">
              <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground text-sm sm:text-base">Cloudless</span>
          </Link>

          {breadcrumb && (
            <>
              <Separator orientation="vertical" className="h-5 sm:h-6 hidden sm:block" />
              <div className="text-xs sm:text-sm text-muted-foreground truncate hidden sm:block">{breadcrumb}</div>
            </>
          )}
        </div>

        {/* Right: user actions + theme toggle */}
        <div className="flex items-center gap-1.5 sm:gap-3">
          {user && (
            <>
              <span className="text-sm text-muted-foreground hidden md:inline">
                {user.display_name}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={() => router.push("/settings")} aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 text-destructive hover:text-destructive" onClick={logout} aria-label="Sign Out">
                <LogOut className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-5 sm:h-6 hidden sm:block" />
            </>
          )}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
