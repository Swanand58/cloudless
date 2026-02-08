"use client";

import { useState } from "react";
import { useRoomStore } from "@/store/room";
import { useAuthStore } from "@/store/auth";
import { SafetyNumber } from "@/components/SafetyNumber";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChevronRight } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export function VerifyIdentity() {
  const { currentRoom, keyPair } = useRoomStore();
  const { user } = useAuthStore();
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<{
    userId: string;
    name: string;
    publicKey: string;
  } | null>(null);

  // Filter out the current user by user_id (more reliable than public_key)
  const otherMembers =
    currentRoom?.members.filter((m) => m.user_id !== user?.id) || [];

  if (otherMembers.length === 0) return null;

  const handleVerifyPeer = (member: { user_id: string; display_name: string; public_key: string }) => {
    setSelectedPeer({ userId: member.user_id, name: member.display_name, publicKey: member.public_key });
    setShowSafetyNumber(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Verify Identity</CardTitle>
          <CardDescription className="text-xs">
            Verify you&apos;re talking to the right person
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {otherMembers.map((member) => (
            <Button
              key={member.user_id}
              variant="ghost"
              className="w-full justify-between"
              onClick={() => handleVerifyPeer(member)}
            >
              <span className="text-sm">{member.display_name}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Safety Number Dialog */}
      <Dialog open={showSafetyNumber} onOpenChange={setShowSafetyNumber}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <VisuallyHidden>
            <DialogTitle>Verify {selectedPeer?.name}</DialogTitle>
          </VisuallyHidden>
          {selectedPeer && keyPair && (
            <SafetyNumber
              myPublicKey={keyPair.publicKey}
              peerPublicKey={selectedPeer.publicKey}
              peerName={selectedPeer.name}
              onVerified={() => setShowSafetyNumber(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
