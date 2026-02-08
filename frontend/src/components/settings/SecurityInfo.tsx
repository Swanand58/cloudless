"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

const features = [
  {
    title: "End-to-End Encryption",
    description: "All files are encrypted on your device using XSalsa20-Poly1305 before leaving your browser.",
  },
  {
    title: "Zero Knowledge",
    description: "The server never sees your encryption keys or file contents. Even filenames are encrypted.",
  },
  {
    title: "Password Security",
    description: "Your password is hashed using Argon2id, a memory-hard function resistant to GPU attacks.",
  },
];

export function SecurityInfo() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {features.map((f) => (
          <div key={f.title} className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">{f.title}</p>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
