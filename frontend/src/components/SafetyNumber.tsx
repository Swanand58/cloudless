"use client";

import { useState, useEffect } from "react";
import { generateSafetyNumber, generateEmojiFingerprint } from "@/lib/crypto";

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

      const myFingerprint = await generateEmojiFingerprint(myPublicKey);
      setMyEmoji(myFingerprint);

      const peerFingerprint = await generateEmojiFingerprint(peerPublicKey);
      setPeerEmoji(peerFingerprint);
    };

    generate();
  }, [myPublicKey, peerPublicKey]);

  const handleVerify = () => {
    setIsVerified(true);
    onVerified?.();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Verify {peerName}
        </h3>
        {isVerified && (
          <span className="flex items-center text-green-600 dark:text-green-400 text-sm">
            <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Verified
          </span>
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Compare these safety numbers with {peerName} over a secure channel (phone call, in-person)
        to verify you&apos;re communicating with the right person.
      </p>

      {/* Emoji fingerprints */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Your fingerprint</p>
          <div className="text-2xl tracking-wider bg-gray-50 dark:bg-gray-900 rounded-lg py-2">
            {myEmoji.join(" ")}
          </div>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{peerName}&apos;s fingerprint</p>
          <div className="text-2xl tracking-wider bg-gray-50 dark:bg-gray-900 rounded-lg py-2">
            {peerEmoji.join(" ")}
          </div>
        </div>
      </div>

      {/* Toggle for numeric safety number */}
      <button
        onClick={() => setShowNumber(!showNumber)}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4"
      >
        {showNumber ? "Hide" : "Show"} numeric safety number
      </button>

      {/* Numeric safety number */}
      {showNumber && (
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-4 font-mono text-sm">
          <div className="grid grid-cols-4 gap-2 text-center">
            {safetyNumber.split(" ").map((group, i) => (
              <span key={i} className="text-gray-700 dark:text-gray-300">
                {group}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Verification instructions */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
          How to verify
        </h4>
        <ol className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-decimal list-inside">
          <li>Call or meet {peerName} in person</li>
          <li>Both read your emoji fingerprints aloud</li>
          <li>Confirm they match on both sides</li>
          <li>Click &quot;Mark as Verified&quot; below</li>
        </ol>
      </div>

      {/* Verify button */}
      {!isVerified && (
        <button
          onClick={handleVerify}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Mark as Verified
        </button>
      )}
    </div>
  );
}
