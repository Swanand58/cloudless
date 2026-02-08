"use client";

import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { Lock, Copy, LogOut } from "lucide-react";
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
    <header className="bg-card border-b border-border">
      <div className="w-full px-6 lg:px-12 py-3 flex items-center justify-between">
        {/* Left: logo + room code */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="p-1.5 bg-primary rounded-lg">
              <Lock className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Cloudless</span>
          </Link>

          <Separator orientation="vertical" className="h-6" />

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Room</span>
            <Badge variant="secondary" className="font-mono font-bold tracking-wider text-primary">
              {currentRoom?.code}
            </Badge>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} aria-label="Copy room code">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {copied && <span className="text-xs text-green-500">Copied!</span>}
          </div>
        </div>

        {/* Right: user + leave + theme toggle */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:inline">{user?.display_name}</span>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" asChild>
            <Link href="/">
              <LogOut className="h-4 w-4 mr-1" />
              Leave
            </Link>
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
