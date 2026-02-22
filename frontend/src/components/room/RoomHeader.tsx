"use client";

import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { Lock, Copy, LogOut, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useState } from "react";

export function RoomHeader() {
  const { user } = useAuthStore();
  const { currentRoom } = useRoomStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentRoom?.code || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <header className="bg-card border-b border-border shrink-0">
      <div className="w-full px-3 sm:px-6 lg:px-12 py-2 sm:py-3 flex items-center justify-between">
        {/* Left: logo + room code */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="p-1.5 bg-primary rounded-lg">
              <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground text-sm sm:text-base hidden sm:inline">Cloudless</span>
          </Link>

          <Separator orientation="vertical" className="h-5 sm:h-6" />

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Badge variant="secondary" className="font-mono font-bold tracking-wider text-primary text-xs sm:text-sm">
              {currentRoom?.code}
            </Badge>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} aria-label="Copy room code">
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Right: user + leave + theme toggle */}
        <div className="flex items-center gap-1.5 sm:gap-3">
          <span className="text-sm text-muted-foreground hidden md:inline">{user?.display_name}</span>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 px-2 sm:px-3" asChild>
            <Link href="/">
              <LogOut className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Leave</span>
            </Link>
          </Button>
          <div className="hidden sm:flex items-center gap-3">
            <Separator orientation="vertical" className="h-6" />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
