"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  ConversationGroup,
} from "@/hooks/use-conversation-history";
import {
  SquarePenIcon,
  MessageSquareIcon,
  Trash2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { VisuallyHidden } from "radix-ui";

// ---------------------------------------------------------------------------
// Sidebar content (shared between desktop expanded & mobile)
// ---------------------------------------------------------------------------

interface SidebarListProps {
  groups: ConversationGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}

function SidebarList({
  groups,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
}: SidebarListProps) {
  return (
    <div className="flex h-full flex-col">
      {/* New Chat button */}
      <div className="flex-none p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground/80 transition-colors hover:bg-accent/50"
        >
          <SquarePenIcon className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">New chat</span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            No conversations yet
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </p>
            {group.conversations.map((conv) => {
              const isActive = conv.id === activeId;
              return (
                <div
                  key={conv.id}
                  className="group relative"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(conv.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/80 hover:bg-accent/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquareIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{conv.title}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete conversation"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar — animated expand/collapse with icon rail
// ---------------------------------------------------------------------------

interface DesktopSidebarProps extends SidebarListProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DesktopSidebar({
  collapsed,
  onToggleCollapse,
  ...listProps
}: DesktopSidebarProps) {
  return (
    <aside
      className={`hidden md:flex flex-col flex-none bg-background text-foreground border-r border-border/50 transition-[width] duration-200 ease-in-out overflow-hidden ${
        collapsed ? "w-[52px]" : "w-64"
      }`}
    >
      {/* Top section: expand/collapse toggle */}
      <div className="flex h-14 flex-none items-center border-b border-border/50 px-2">
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Open sidebar"
            className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpenIcon className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex w-full items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">History</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
            >
              <PanelLeftCloseIcon className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Content: icon rail when collapsed, full list when expanded */}
      {collapsed ? (
        <div className="flex flex-col items-center py-3 gap-2">
          <button
            type="button"
            onClick={listProps.onNewChat}
            aria-label="New chat"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <SquarePenIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      ) : (
        <SidebarList {...listProps} />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mobile sidebar (Sheet overlay)
// ---------------------------------------------------------------------------

interface MobileSidebarProps extends SidebarListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileSidebar({
  open,
  onOpenChange,
  ...listProps
}: MobileSidebarProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0 bg-background" showCloseButton={false}>
        <VisuallyHidden.Root>
          <SheetTitle>Conversation History</SheetTitle>
        </VisuallyHidden.Root>
        <SidebarList
          {...listProps}
          onSelect={(id) => {
            listProps.onSelect(id);
            onOpenChange(false);
          }}
          onNewChat={() => {
            listProps.onNewChat();
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
