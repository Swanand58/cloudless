"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { useLoader } from "@/hooks/useLoader";
import { api } from "@/lib/api";
import { toast } from "sonner";

import { RoomHeader } from "@/components/room/RoomHeader";
import { VerifyIdentity } from "@/components/room/VerifyIdentity";
import { SecurityBadge } from "@/components/room/SecurityBadge";
import { ChatWindow } from "@/components/ChatWindow";
import { PeerStatus } from "@/components/PeerStatus";
import { Button } from "@/components/ui/button";
import { AlertTriangle, UserMinus, UserPlus } from "lucide-react";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const { isAuthenticated, fetchUser } = useAuthStore();
  const { 
    loadRoom, 
    leaveRoom, 
    currentRoom, 
    lastUserJoined, 
    lastUserLeft, 
    clearLastUserJoined, 
    clearLastUserLeft 
  } = useRoomStore();
  const { setLoading } = useLoader();

  const [isPageLoading, setIsPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Show toast when a user joins the room
  useEffect(() => {
    if (lastUserJoined) {
      toast(`${lastUserJoined} joined the room`, {
        icon: <UserPlus className="h-4 w-4 text-green-500" />,
        duration: 4000,
      });
      clearLastUserJoined();
    }
  }, [lastUserJoined, clearLastUserJoined]);

  // Show toast when a user leaves the room
  useEffect(() => {
    if (lastUserLeft) {
      toast(`${lastUserLeft} left the room`, {
        icon: <UserMinus className="h-4 w-4 text-muted-foreground" />,
        duration: 4000,
      });
      clearLastUserLeft();
    }
  }, [lastUserLeft, clearLastUserLeft]);

  useEffect(() => {
    if (hasInitialized) return;
    setLoading(true, "Checking authentication...");
    fetchUser();
  }, [fetchUser, hasInitialized, setLoading]);

  useEffect(() => {
    if (hasInitialized) return;

    if (!isAuthenticated) {
      const timeout = setTimeout(() => {
        if (!api.isAuthenticated()) {
          setLoading(false);
          router.push("/login");
        }
      }, 100);
      return () => clearTimeout(timeout);
    }

    const initRoom = async () => {
      try {
        setHasInitialized(true);
        setLoading(true, "Loading room...");
        await loadRoom(roomId);
        setIsPageLoading(false);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load room");
        setIsPageLoading(false);
        setLoading(false);
      }
    };
    initRoom();

    return () => {
      leaveRoom();
    };
  }, [roomId, isAuthenticated, loadRoom, leaveRoom, router, hasInitialized, setLoading]);

  // Don't render until loaded
  if (isPageLoading) return null;

  /* ---------- Error (room not found) ---------- */
  if (error && !currentRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="p-4 bg-destructive/10 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Room Not Found</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button asChild>
            <Link href="/">Go Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- Room ---------- */
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <RoomHeader />

      <main className="flex-1 px-4 lg:px-8 py-4 overflow-hidden">
        <div className="grid lg:grid-cols-4 gap-4 h-full">
          {/* Left column - Chat (full height) */}
          <div className="lg:col-span-3 h-full min-h-0">
            <ChatWindow className="h-full" />
          </div>

          {/* Right column - Room info */}
          <div className="lg:col-span-1 space-y-4 overflow-y-auto">
            <PeerStatus />
            <VerifyIdentity />
            <SecurityBadge />
          </div>
        </div>
      </main>
    </div>
  );
}
