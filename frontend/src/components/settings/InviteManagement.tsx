"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { withRoleProtection } from "@/lib/withRoleProtection";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";

interface Invite {
  code: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  note: string | null;
}

function InviteManagement() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [note, setNote] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    loadInvites();
  }, []);

  const loadInvites = async () => {
    try {
      const data = await api.listInvites();
      setInvites(data);
    } catch (error) {
      console.error("Failed to load invites:", error);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await api.createInvite(1, 7, note || undefined);
      setNote("");
      await loadInvites();
    } catch (error) {
      console.error("Failed to create invite:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Invite Friends</CardTitle>
          <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
            Admin
          </Badge>
        </div>
        <CardDescription>
          Create invite codes to let friends register on your Cloudless instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Create invite form */}
        <div className="flex gap-3">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional, e.g., 'For Alice')"
            className="flex-1"
          />
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Invite"}
          </Button>
        </div>

        {/* Invite list */}
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No invite codes yet. Create one to invite friends.
          </p>
        ) : (
          <div className="space-y-3">
            {invites.map((invite) => (
              <div
                key={invite.code}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <code className="font-mono font-bold text-primary">
                      {invite.code}
                    </code>
                    {invite.use_count >= invite.max_uses && (
                      <Badge variant="secondary">Used</Badge>
                    )}
                  </div>
                  {invite.note && (
                    <p className="text-xs text-muted-foreground mt-1">{invite.note}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {invite.use_count}/{invite.max_uses} uses
                    {invite.expires_at && (
                      <span> - Expires {new Date(invite.expires_at).toLocaleDateString()}</span>
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => copyCode(invite.code)} aria-label="Copy code">
                  {copiedCode === invite.code ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Only rendered for admin users */
export const AdminInviteManagement = withRoleProtection(InviteManagement, ["admin"]);
