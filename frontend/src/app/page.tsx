"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { useLoader } from "@/hooks/useLoader";
import { AppHeader } from "@/components/AppHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Lock, Plus, LogIn, ShieldCheck, Server, Zap, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, fetchUser } = useAuthStore();
  const { createRoom, joinRoom } = useRoomStore();
  const { setLoading } = useLoader();
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true, "Checking authentication...");
      await fetchUser();
      setAuthChecked(true);
      setLoading(false);
    };
    checkAuth();
  }, [fetchUser, setLoading]);

  // Don't render anything until auth check completes
  if (!authChecked) return null;

  const handleCreateRoom = async () => {
    setError(null);
    setIsCreating(true);
    try {
      const room = await createRoom();
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setError(null);
    setIsJoining(true);
    try {
      const room = await joinRoom(joinCode.trim().toUpperCase());
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setIsJoining(false);
    }
  };

  /* ---------- Landing page (unauthenticated) ---------- */
  if (!isAuthenticated) {
    const features = [
      { icon: Lock, title: "E2E Encrypted", desc: "Your files are encrypted before leaving your device", color: "text-blue-500" },
      { icon: Server, title: "Self-Hosted", desc: "Runs on your own hardware, under your control", color: "text-green-500" },
      { icon: Zap, title: "P2P Transfer", desc: "Direct transfers when possible, no middleman", color: "text-purple-500" },
      { icon: Shield, title: "Verified", desc: "Safety numbers to verify recipients", color: "text-orange-500" },
    ];

    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-8 sm:p-8 relative">
        {/* Theme toggle in top-right */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
          <ThemeToggle />
        </div>

        <div className="max-w-md w-full text-center space-y-6 sm:space-y-8">
          {/* Logo */}
          <div>
            <div className="flex justify-center mb-4">
              <div className="p-3 sm:p-4 bg-primary rounded-2xl">
                <Lock className="h-10 w-10 sm:h-12 sm:w-12 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground">Cloudless</h1>
            <p className="mt-2 text-base sm:text-lg text-muted-foreground">Secure, self-hosted file transfer</p>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 text-left">
            {features.map((f) => (
              <Card key={f.title} className="p-3 sm:p-4">
                <f.icon className={`h-5 w-5 sm:h-6 sm:w-6 mb-2 ${f.color}`} />
                <h3 className="font-medium text-foreground text-sm sm:text-base">{f.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            ))}
          </div>

          {/* Auth buttons */}
          <div className="space-y-3">
            <Button className="w-full" size="lg" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button variant="outline" className="w-full" size="lg" asChild>
              <Link href="/register">Create Account</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- Dashboard (authenticated) ---------- */
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader maxWidth="w-full" />

      <main className="flex-1 px-4 sm:px-6 lg:px-12 py-4 sm:py-8">
        {error && (
          <Alert variant="destructive" className="mb-4 sm:mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Create Room */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Create Room</CardTitle>
              </div>
              <CardDescription>
                Start a new secure transfer room. Share the code with your friend to begin.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="lg" onClick={handleCreateRoom} disabled={isCreating}>
                {isCreating ? "Creating..." : "Create New Room"}
              </Button>
            </CardContent>
          </Card>

          {/* Join Room */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <LogIn className="h-6 w-6 text-green-500" />
                </div>
                <CardTitle>Join Room</CardTitle>
              </div>
              <CardDescription>
                Enter a room code to join an existing transfer session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoinRoom} className="space-y-3">
                <Input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Enter room code"
                  maxLength={6}
                  className="text-center text-xl font-mono tracking-widest uppercase"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="w-full"
                  size="lg"
                  disabled={isJoining || !joinCode.trim()}
                >
                  {isJoining ? "Joining..." : "Join Room"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Security note */}
          <Card className="lg:col-span-1">
            <CardContent className="flex items-start gap-3 pt-6 h-full">
              <ShieldCheck className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-medium text-foreground">Your Security</h3>
                <p className="text-sm text-muted-foreground">
                  All files are encrypted on your device before transfer. The server never sees your data.
                  Use safety numbers to verify you&apos;re talking to the right person.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
