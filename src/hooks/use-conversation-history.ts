"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredConversation {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversationGroup {
  label: string;
  conversations: StoredConversation[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "qcs-conversations";
const MAX_CONVERSATIONS = 50;
const TITLE_MAX_LENGTH = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

function readStorage(): StoredConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredConversation[];
  } catch {
    return [];
  }
}

function writeStorage(conversations: StoredConversation[]) {
  if (typeof window === "undefined") return;
  // Prune to max limit (keep newest)
  const pruned = conversations
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
}

function titleFromMessages(messages: UIMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New conversation";
  const text = firstUserMsg.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ")
    .trim();
  if (!text) return "New conversation";
  return text.length > TITLE_MAX_LENGTH
    ? text.slice(0, TITLE_MAX_LENGTH).trimEnd() + "…"
    : text;
}

export function groupConversationsByDate(
  conversations: StoredConversation[]
): ConversationGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const sevenDaysAgo = today - 7 * 86400000;

  const groups: Record<string, StoredConversation[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    Older: [],
  };

  for (const conv of conversations) {
    if (conv.updatedAt >= today) {
      groups["Today"].push(conv);
    } else if (conv.updatedAt >= yesterday) {
      groups["Yesterday"].push(conv);
    } else if (conv.updatedAt >= sevenDaysAgo) {
      groups["Previous 7 Days"].push(conv);
    } else {
      groups["Older"].push(conv);
    }
  }

  return Object.entries(groups)
    .filter(([, convs]) => convs.length > 0)
    .map(([label, convs]) => ({ label, conversations: convs }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversationHistory() {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const initialized = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const stored = readStorage();
    setConversations(stored);
  }, []);

  const createConversation = useCallback((): string => {
    const id = generateId();
    const now = Date.now();
    const conv: StoredConversation = {
      id,
      title: "New conversation",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations((prev) => {
      const updated = [conv, ...prev];
      writeStorage(updated);
      return updated;
    });
    setActiveId(id);
    return id;
  }, []);

  const selectConversation = useCallback(
    (id: string): UIMessage[] | null => {
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return null;
      setActiveId(id);
      return conv.messages;
    },
    [conversations]
  );

  const updateConversation = useCallback(
    (id: string, messages: UIMessage[]) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx === -1) return prev;
        const conv = prev[idx];
        const updated = [...prev];
        updated[idx] = {
          ...conv,
          messages,
          title: messages.length > 0 ? titleFromMessages(messages) : conv.title,
          updatedAt: Date.now(),
        };
        writeStorage(updated);
        return updated;
      });
    },
    []
  );

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const updated = prev.filter((c) => c.id !== id);
        writeStorage(updated);
        // If deleting active conversation, clear active
        if (activeId === id) {
          setActiveId(null);
        }
        return updated;
      });
    },
    [activeId]
  );

  return {
    conversations,
    activeId,
    setActiveId,
    createConversation,
    selectConversation,
    updateConversation,
    deleteConversation,
    groupedConversations: groupConversationsByDate(conversations),
  };
}
