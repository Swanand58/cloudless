"use client";

import { useState } from "react";
import { useRoomStore, getPeer } from "@/store/room";
import { SafetyNumber } from "@/components/SafetyNumber";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export function VerifyIdentity() {
  const { currentRoom, keyPair, myUserId, peerVerified, markPeerVerified } = useRoomStore();
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);

  const peer = getPeer(currentRoom, myUserId);

  if (!peer || !keyPair) return null;

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
          <Button
            variant="ghost"
            className="w-full justify-between"
            onClick={() => setShowSafetyNumber(true)}
          >
            <span className="text-sm">{peer.display_name}</span>
            {peerVerified ? (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <ShieldCheck className="h-4 w-4" />
                Verified
              </span>
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Safety Number Dialog */}
      <Dialog open={showSafetyNumber} onOpenChange={setShowSafetyNumber}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <VisuallyHidden>
            <DialogTitle>Verify {peer.display_name}</DialogTitle>
          </VisuallyHidden>
          <SafetyNumber
            myPublicKey={keyPair.publicKey}
            peerPublicKey={peer.public_key}
            peerName={peer.display_name}
            verified={peerVerified}
            onVerified={() => {
              markPeerVerified();
              setShowSafetyNumber(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
