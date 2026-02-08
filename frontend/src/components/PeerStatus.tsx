"use client";

import { useState } from "react";
import { useRoomStore } from "@/store/room";
import { useAuthStore } from "@/store/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface PeerStatusProps {
  className?: string;
}

export function PeerStatus({ className = "" }: PeerStatusProps) {
  const { currentRoom, onlineUsers } = useRoomStore();
  const { user } = useAuthStore();
  const [copied, setCopied] = useState(false);

  if (!currentRoom) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentRoom.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Sort members: current user first, then online users, then offline
  const sortedMembers = [...currentRoom.members].sort((a, b) => {
    const aIsMe = a.user_id === user?.id;
    const bIsMe = b.user_id === user?.id;
    if (aIsMe) return -1;
    if (bIsMe) return 1;
    
    const aOnline = onlineUsers.has(a.user_id);
    const bOnline = onlineUsers.has(b.user_id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return 0;
  });

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Room Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedMembers.map((member) => {
          const isOnline = onlineUsers.has(member.user_id);
          const isMe = member.user_id === user?.id;
          
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
                {isOnline ? "Online" : "Left"}
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
      </CardContent>
    </Card>
  );
}
