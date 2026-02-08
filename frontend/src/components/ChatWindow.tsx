"use client";

import { useState, useRef, useEffect } from "react";
import { useRoomStore, DecryptedMessage } from "@/store/room";

interface ChatWindowProps {
  className?: string;
}

export function ChatWindow({ className = "" }: ChatWindowProps) {
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const { messages, typingUsers, sendMessage, setTyping } = useRoomStore();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMessage(message.trim());
      setMessage("");
      setTyping(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    
    // Send typing indicator
    setTyping(true);
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Stop typing after 2 seconds of no input
    typingTimeoutRef.current = setTimeout(() => {
      setTyping(false);
    }, 2000);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const typingNames = Array.from(typingUsers.values());

  return (
    <div className={`flex flex-col bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-gray-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="font-medium text-gray-900 dark:text-white">Encrypted Chat</span>
          <span className="ml-2 text-xs text-green-600 dark:text-green-400 flex items-center">
            <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            E2E Encrypted
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[400px]">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <svg className="h-12 w-12 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p>No messages yet</p>
            <p className="text-sm">Start a secure conversation</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-sm text-gray-500 dark:text-gray-400">
          {typingNames.length === 1 
            ? `${typingNames[0]} is typing...`
            : `${typingNames.join(", ")} are typing...`}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex space-x-2">
          <input
            type="text"
            value={message}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!message.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: DecryptedMessage }) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className={`flex ${message.isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 ${
          message.isOwn
            ? "bg-blue-600 text-white"
            : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
        }`}
      >
        {!message.isOwn && (
          <p className="text-xs font-medium opacity-75 mb-1">
            {message.senderName}
          </p>
        )}
        <p className="break-words">{message.content}</p>
        <p className={`text-xs mt-1 ${message.isOwn ? "text-blue-200" : "text-gray-500 dark:text-gray-400"}`}>
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
