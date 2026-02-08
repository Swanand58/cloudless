"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

export function SecurityBadge() {
  return (
    <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
      <CardContent className="flex items-start gap-3 pt-4 pb-4">
        <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
        <div>
          <h3 className="font-medium text-green-800 dark:text-green-200 text-sm">
            End-to-End Encrypted
          </h3>
          <p className="text-xs text-green-700 dark:text-green-300 mt-1">
            Files are encrypted on your device. The server cannot read your data.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
