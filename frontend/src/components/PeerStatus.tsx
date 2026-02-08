"use client";

import { useRoomStore } from "@/store/room";

interface PeerStatusProps {
  className?: string;
}

export function PeerStatus({ className = "" }: PeerStatusProps) {
  const { currentRoom, onlineUsers } = useRoomStore();

  if (!currentRoom) {
    return null;
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${className}`}>
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
        Room Members
      </h3>
      
      <div className="space-y-2">
        {currentRoom.members.map((member) => {
          const isOnline = onlineUsers.has(member.user_id);
          
          return (
            <div
              key={member.user_id}
              className="flex items-center justify-between"
            >
              <div className="flex items-center">
                <div
                  className={`w-2 h-2 rounded-full mr-2 ${
                    isOnline ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {member.display_name}
                </span>
              </div>
              
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          );
        })}
      </div>
      
      {currentRoom.members.length === 1 && (
        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            Share the room code with someone to start transferring files:
          </p>
          <div className="mt-2 flex items-center justify-between bg-white dark:bg-gray-900 rounded px-3 py-2">
            <code className="text-lg font-bold text-blue-600 dark:text-blue-400 tracking-wider">
              {currentRoom.code}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(currentRoom.code);
              }}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              title="Copy code"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
