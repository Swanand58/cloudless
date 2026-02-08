"use client";

import { useState, useEffect } from "react";
import { generateSafetyNumber, generateEmojiFingerprint } from "@/lib/crypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, Eye, EyeOff } from "lucide-react";

interface SafetyNumberProps {
  myPublicKey: string;
  peerPublicKey: string;
  peerName: string;
  onVerified?: () => void;
}

export function SafetyNumber({
  myPublicKey,
  peerPublicKey,
  peerName,
  onVerified,
}: SafetyNumberProps) {
  const [safetyNumber, setSafetyNumber] = useState<string>("");
  const [myEmoji, setMyEmoji] = useState<string[]>([]);
  const [peerEmoji, setPeerEmoji] = useState<string[]>([]);
  const [showNumber, setShowNumber] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    const generate = async () => {
      const number = await generateSafetyNumber(myPublicKey, peerPublicKey);
      setSafetyNumber(number);
      setMyEmoji(await generateEmojiFingerprint(myPublicKey));
      setPeerEmoji(await generateEmojiFingerprint(peerPublicKey));
    };
    generate();
  }, [myPublicKey, peerPublicKey]);

  const handleVerify = () => {
    setIsVerified(true);
    onVerified?.();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Verify {peerName}</CardTitle>
          {isVerified && (
            <Badge variant="default" className="bg-green-600 gap-1">
              <ShieldCheck className="h-3 w-3" />
              Verified
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Compare these safety numbers with {peerName} over a secure channel (phone call, in-person) to verify you&apos;re communicating with the right person.
        </p>

        {/* Emoji fingerprints */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-2">Your fingerprint</p>
            <div className="text-2xl tracking-wider bg-muted rounded-lg py-2">
              {myEmoji.join(" ")}
            </div>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-2">{peerName}&apos;s fingerprint</p>
            <div className="text-2xl tracking-wider bg-muted rounded-lg py-2">
              {peerEmoji.join(" ")}
            </div>
          </div>
        </div>

        {/* Toggle numeric */}
        <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => setShowNumber(!showNumber)}>
          {showNumber ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
          {showNumber ? "Hide" : "Show"} numeric safety number
        </Button>

        {showNumber && (
          <div className="bg-muted rounded-lg p-4 font-mono text-sm">
            <div className="grid grid-cols-4 gap-2 text-center">
              {safetyNumber.split(" ").map((group, i) => (
                <span key={i} className="text-foreground">
                  {group}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Instructions */}
        <Alert className="border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20">
          <AlertDescription>
            <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">How to verify</h4>
            <ol className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-decimal list-inside">
              <li>Call or meet {peerName} in person</li>
              <li>Both read your emoji fingerprints aloud</li>
              <li>Confirm they match on both sides</li>
              <li>Click &quot;Mark as Verified&quot; below</li>
            </ol>
          </AlertDescription>
        </Alert>

        {/* Verify button */}
        {!isVerified && (
          <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleVerify}>
            Mark as Verified
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
