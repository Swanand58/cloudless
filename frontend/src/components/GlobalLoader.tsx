"use client";

import { useLoader } from "@/hooks/useLoader";
import { Lock } from "lucide-react";

export function GlobalLoader() {
  const { isLoading, message } = useLoader();

  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-primary rounded-xl">
            <Lock className="h-8 w-8 text-primary-foreground animate-pulse" />
          </div>
        </div>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="mt-4 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
