"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRoomStore } from "@/store/room";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, LogOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PeerStatusProps {
  className?: string;
}

function daysLeft(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export function PeerStatus({ className = "" }: PeerStatusProps) {
  const router = useRouter();
  const { currentRoom, onlineUsers, myUserId, leaveRoom } = useRoomStore();
  const [copied, setCopied] = useState(false);

  if (!currentRoom) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentRoom.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeave = async () => {
    if (
      !window.confirm(
        "Leave this room for good? You will lose access to its messages and files on this device."
      )
    ) {
      return;
    }
    try {
      await leaveRoom();
      router.push("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not leave the room");
    }
  };

  // Current user first
  const sortedMembers = [...currentRoom.members].sort(
    (a, b) => Number(b.user_id === myUserId) - Number(a.user_id === myUserId)
  );
  const expiry = daysLeft(currentRoom.expires_at);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Room Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedMembers.map((member) => {
          const isMe = member.user_id === myUserId;
          const isOnline = isMe || onlineUsers.has(member.user_id);

          return (
            <div key={member.user_id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    isOnline ? "bg-green-500" : "bg-muted-foreground/40"
                  )}
                />
                <span className={cn(
                  "text-sm",
                  isMe ? "text-foreground font-medium" : "text-foreground"
                )}>
                  {member.display_name}
                  {isMe && <span className="text-muted-foreground ml-1">(you)</span>}
                </span>
              </div>
              <Badge
                variant={isOnline ? "default" : "secondary"}
                className={cn(
                  "text-xs",
                  !isOnline && "text-muted-foreground"
                )}
              >
                {isOnline ? "Online" : "Offline"}
              </Badge>
            </div>
          );
        })}

        {currentRoom.members.length === 1 && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Share the room code with someone to start transferring files:
            </p>
            <div className="mt-2 flex items-center justify-between bg-card rounded px-3 py-2">
              <code className="text-lg font-bold text-primary tracking-wider">
                {currentRoom.code}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                onClick={handleCopy}
                aria-label="Copy code"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-green-500">Copied!</span>
                  </>
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="pt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{expiry}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive"
            onClick={handleLeave}
          >
            <LogOut className="h-4 w-4 mr-1" />
            Leave room
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
