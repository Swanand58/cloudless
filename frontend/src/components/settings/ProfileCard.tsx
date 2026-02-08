"use client";

import { useAuthStore } from "@/store/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ProfileCard() {
  const { user } = useAuthStore();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Username</p>
          <p className="text-foreground">{user?.username}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Display Name</p>
          <p className="text-foreground">{user?.display_name}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Account Type</p>
          <Badge variant={user?.is_admin ? "default" : "secondary"}>
            {user?.is_admin ? "Administrator" : "User"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
