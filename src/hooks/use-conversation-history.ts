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
    const parsed = JSON.parse(raw) as StoredConversation[];
    return parsed.map((conv) => {
      if (
        (!conv.title || conv.title === "New conversation") &&
        Array.isArray(conv.messages) &&
        conv.messages.length > 0
      ) {
        return { ...conv, title: titleFromMessages(conv.messages) };
      }
      return conv;
    });
  } catch {
    return [];
  }
}

/** Strip large binary/file data from messages before persisting. */
function stripBinaryParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts
      .filter((p) => p.type !== "file")
      .map((p) => {
        // Strip any inline data URLs from tool results that may contain images
        if (p.type === "text") {
          const tp = p as { type: "text"; text: string };
          if (tp.text.length > 50_000) {
            return { ...tp, text: tp.text.slice(0, 50_000) + "\n[...truncated for storage]" };
          }
        }
        return p;
      }),
  }));
}

function writeStorage(conversations: StoredConversation[]) {
  if (typeof window === "undefined") return;
  // Prune to max limit (keep newest)
  const pruned = conversations
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  // Strip binary data to avoid exceeding localStorage quota (~5-10MB)
  const lightweight = pruned.map((c) => ({
    ...c,
    messages: stripBinaryParts(c.messages),
  }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweight));
  } catch {
    // If still too large, keep only recent conversations and retry
    try {
      const fewer = lightweight.slice(0, Math.max(5, Math.floor(lightweight.length / 2)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fewer));
    } catch {
      // Last resort: clear storage to prevent app crash
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

function normalizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\b(?:please\s+)?review\s+(?:the\s+following\s+)?construction\s+submittal(?:\s+against\s+qcs\s+2024\s+requirements)?[:\-]?\s*/i, "")
    .trim();

  if (!cleaned) return "New conversation";
  return cleaned.length > TITLE_MAX_LENGTH
    ? cleaned.slice(0, TITLE_MAX_LENGTH).trimEnd() + "…"
    : cleaned;
}

function baseNameFromFilename(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, "");
  return normalizeTitle(noExt);
}

function extractFirstUserText(messages: UIMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "";
  return firstUserMsg.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ")
    .trim();
}

function extractFirstUserFilename(messages: UIMessage[]): string | null {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return null;
  const filePart = firstUserMsg.parts.find((p) => p.type === "file") as
    | { filename?: string }
    | undefined;
  if (!filePart?.filename) return null;
  return filePart.filename;
}

function extractAssistantVerdict(messages: UIMessage[]): string | null {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join(" ");
    const match = /\b(APPROVED|REJECTED|NEEDS REVISION)\b/i.exec(text);
    if (match) {
      const verdict = match[1].toUpperCase();
      return verdict === "NEEDS REVISION" ? "REJECTED" : verdict;
    }
  }
  return null;
}

function titleFromMessages(messages: UIMessage[]): string {
  if (messages.length === 0) return "New conversation";

  const userText = extractFirstUserText(messages);
  const firstFilename = extractFirstUserFilename(messages);
  const verdict = extractAssistantVerdict(messages);

  let coreTitle = "";
  if (firstFilename) {
    coreTitle = `Review ${baseNameFromFilename(firstFilename)}`;
  } else if (userText) {
    coreTitle = normalizeTitle(userText);
  } else {
    coreTitle = "New conversation";
  }

  if (verdict && coreTitle !== "New conversation") {
    return normalizeTitle(`${verdict} - ${coreTitle}`);
  }

  return coreTitle;
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
