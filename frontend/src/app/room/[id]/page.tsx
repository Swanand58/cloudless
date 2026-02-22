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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AlertTriangle, UserMinus, UserPlus, Users } from "lucide-react";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (lastUserJoined) {
      toast(`${lastUserJoined} joined the room`, {
        icon: <UserPlus className="h-4 w-4 text-green-500" />,
        duration: 4000,
      });
      clearLastUserJoined();
    }
  }, [lastUserJoined, clearLastUserJoined]);

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

  if (isPageLoading) return null;

  if (error && !currentRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
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

  const sidebarContent = (
    <div className="space-y-4">
      <PeerStatus />
      <VerifyIdentity />
      <SecurityBadge />
    </div>
  );

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <RoomHeader />

      {/* Mobile sidebar toggle */}
      <div className="lg:hidden flex items-center justify-end px-3 py-1.5 border-b border-border bg-card/50">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" />
              Room Info
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] sm:w-[360px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Room Info</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              {sidebarContent}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <main className="flex-1 px-2 sm:px-4 lg:px-8 py-2 sm:py-4 overflow-hidden min-h-0">
        <div className="grid lg:grid-cols-4 gap-4 h-full">
          {/* Chat takes full width on mobile */}
          <div className="lg:col-span-3 h-full min-h-0">
            <ChatWindow className="h-full" />
          </div>

          {/* Desktop sidebar only */}
          <div className="hidden lg:block lg:col-span-1 space-y-4 overflow-y-auto">
            {sidebarContent}
          </div>
        </div>
      </main>
    </div>
  );
}
