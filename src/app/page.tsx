"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import Image from "next/image";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DesktopSidebar,
  MobileSidebar,
} from "@/components/sidebar";
import { useConversationHistory } from "@/hooks/use-conversation-history";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  AttachmentRemove,
} from "@/components/ai-elements/attachments";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputHeader,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircleIcon,
  XCircleIcon,
  AlertTriangleIcon,
  ClipboardIcon,
  FileTextIcon,
  HardHatIcon,
  BuildingIcon,
  PlusIcon,
  PaperclipIcon,
  SearchIcon,
  MenuIcon,
  NetworkIcon,
  DatabaseIcon,
} from "lucide-react";

const BRAND_LOGO_SRC = "/cb.svg";

// ---------------------------------------------------------------------------
// Sample submittals
// ---------------------------------------------------------------------------

const SAMPLE_SUBMITTALS = [
  {
    label: "Cement Submittal",
    description: "Portland Cement Type I review",
    icon: <BuildingIcon className="h-4 w-4" />,
    text: `Please review the following construction submittal against QCS 2024 requirements:

MATERIAL SUBMITTAL - Portland Cement

Contractor: Al-Rayyan Construction LLC
Project: Highway Bridge Expansion - Lusail
Submittal No: MAT-2024-0156

Material: Portland Cement Type I
Manufacturer: Qatar National Cement Company (QNCC)
Standard: ASTM C150 / BS EN 197-1
Bag Weight: 50 kg

Properties:
- Compressive Strength (3 days): 18 MPa
- Compressive Strength (7 days): 26 MPa
- Compressive Strength (28 days): 42 MPa
- Initial Setting Time: 120 minutes
- Final Setting Time: 240 minutes
- Fineness (Blaine): 320 m²/kg

Test Certificates: Mill test certificate from QNCC Lab attached
Quantity Required: 5,000 tonnes
Delivery Schedule: 500 tonnes/month over 10 months`,
  },
  {
    label: "Concrete Mix Design",
    description: "Grade C40/20 mix review",
    icon: <HardHatIcon className="h-4 w-4" />,
    text: `Please review the following construction submittal against QCS 2024 requirements:

SUBMITTAL - Concrete Mix Design

Contractor: Qatar Building Company
Project: Commercial Tower - West Bay
Submittal No: MIX-2024-0089

Mix Designation: Grade C40/20
Target Strength: 40 MPa at 28 days
Maximum Aggregate Size: 20 mm
Slump: 100 ± 25 mm
Water/Cement Ratio: 0.45

Materials:
- Cement: OPC Type I (QNCC), 380 kg/m³
- Fine Aggregate: Washed sand, 720 kg/m³
- Coarse Aggregate: Gabbro 20mm, 1100 kg/m³
- Water: Potable, 171 L/m³
- Admixture: Superplasticizer (Sika ViscoCrete), 3.8 L/m³

Trial Mix Results:
- 7-day strength: 32 MPa
- 28-day strength: 46 MPa
- Slump: 110 mm
- Air Content: 2.1%
- Temperature at placement: 28°C`,
  },
  {
    label: "Waterproofing Membrane",
    description: "Bituminous membrane review",
    icon: <FileTextIcon className="h-4 w-4" />,
    text: `Please review the following construction submittal against QCS 2024 requirements:

MATERIAL SUBMITTAL - Waterproofing System

Contractor: National Construction Co.
Project: Underground Parking Structure - The Pearl
Submittal No: MAT-2024-0234

Product: Bituminous Waterproofing Membrane
Manufacturer: Sika AG
Product Name: Sika Proof Membrane
Type: Modified Bitumen Sheet, torch-applied
Thickness: 4 mm

Application: Below-grade foundation walls and raft foundation
Area: 12,500 m²

Properties:
- Tensile Strength: 25 N/mm (longitudinal)
- Elongation at Break: 35%
- Water Vapor Transmission: 0.2 g/m².24h
- Temperature Resistance: -20°C to +100°C
- Root Resistance: Yes (EN 13948)

Installation Method: Torch-applied, single layer with 100mm side laps and 150mm end laps
Primer: Sika Igol Primer applied to prepared substrate
Surface Preparation: Clean, dry concrete surface, min 28 days cured`,
  },
  {
    label: "Steel Reinforcement",
    description: "Deformed bars B500B review",
    icon: <BuildingIcon className="h-4 w-4" />,
    text: `Please review the following construction submittal against QCS 2024 requirements:

MATERIAL SUBMITTAL - Steel Reinforcement

Contractor: Modern Construction Group
Project: Residential Complex - Lusail City
Submittal No: MAT-2024-0312

Material: Deformed Steel Reinforcement Bars
Manufacturer: Qatar Steel Company
Standard: BS 4449:2005 Grade B500B / ASTM A615 Grade 60
Origin: Qatar (Local Production)

Bar Sizes Submitted:
- 10mm, 12mm, 16mm, 20mm, 25mm, 32mm

Mechanical Properties (from Mill Certificate):
- Yield Strength: 520 MPa (min 500 MPa required)
- Tensile Strength: 610 MPa
- Elongation: 16%
- Bend Test: Passed (180° bend, no cracks)
- Rebend Test: Passed

Chemical Composition:
- Carbon: 0.22%
- Manganese: 0.85%
- Sulphur: 0.035%
- Phosphorus: 0.030%

Quantity: 8,500 tonnes
Delivery: Monthly as per construction schedule
Storage: Covered storage area, raised off ground on timber bearers`,
  },
];

// ---------------------------------------------------------------------------
// Verdict helper
// ---------------------------------------------------------------------------

const VERDICT_CONFIG = {
  APPROVED: {
    label: "APPROVED",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
    icon: CheckCircleIcon,
  },
  REJECTED: {
    label: "REJECTED",
    className: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
    icon: XCircleIcon,
  },
  "NEEDS REVISION": {
    label: "NEEDS REVISION",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
    icon: AlertTriangleIcon,
  },
} as const;

function getVerdictInfo(text: string) {
  const upper = text.toUpperCase();
  if (upper.includes("**APPROVED**") || /VERDICT[:\s]*\n?\s*\*{0,2}APPROVED/.test(upper)) {
    return VERDICT_CONFIG.APPROVED;
  }
  if (upper.includes("**REJECTED**") || /VERDICT[:\s]*\n?\s*\*{0,2}REJECTED/.test(upper)) {
    return VERDICT_CONFIG.REJECTED;
  }
  if (upper.includes("NEEDS REVISION")) {
    return VERDICT_CONFIG["NEEDS REVISION"];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse QCS sources from tool invocations
// ---------------------------------------------------------------------------

interface QCSSource {
  reference: string;
  score: number;
  source: "vector" | "graph";
}

function parseQCSSources(message: UIMessage): QCSSource[] {
  const sources: QCSSource[] = [];
  for (const part of message.parts) {
    if (part.type.startsWith("tool-") && "state" in part && part.state === "output-available") {
      const result = (part as any).output;
      if (Array.isArray(result)) {
        for (const item of result) {
          if (item.reference) {
            sources.push({
              reference: item.reference,
              score: item.relevanceScore ?? 0,
              source: item.source === "graph" ? "graph" : "vector",
            });
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.reference)) return false;
    seen.add(s.reference);
    return true;
  });
}

// ---------------------------------------------------------------------------
// ChatMessages component
// ---------------------------------------------------------------------------

function ChatMessages({ messages, status }: { messages: UIMessage[]; status: string }) {
  const isStreaming = status === "streaming";

  return (
    <>
      {messages.map((message) => {
        const isUser = message.role === "user";
        const textParts = message.parts.filter((p) => p.type === "text");
        const fullText = textParts
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("");
        const toolParts = message.parts.filter((p) => p.type.startsWith("tool-"));
        const fileParts = message.parts.filter((p) => p.type === "file");
        const verdict = !isUser ? getVerdictInfo(fullText) : null;
        const qcsSources = !isUser ? parseQCSSources(message) : [];
        const isLastAssistant =
          !isUser && message.id === messages[messages.length - 1]?.id;

        return (
          <Message key={message.id} from={message.role}>
            {isUser && fileParts.length > 0 && (
              <Attachments variant="grid">
                {fileParts.map((part, idx) => (
                  <Attachment key={idx} data={part as any}>
                    <AttachmentPreview />
                    <AttachmentInfo />
                  </Attachment>
                ))}
              </Attachments>
            )}

            <MessageContent>
              {isUser ? (
                <div className="whitespace-pre-wrap">{fullText}</div>
              ) : (
                <>
                  {toolParts.length > 0 && (() => {
                    const graphCount = qcsSources.filter((s) => s.source === "graph").length;
                    const hasGraphSources = graphCount > 0;
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        {hasGraphSources ? (
                          <NetworkIcon className="h-3 w-3" />
                        ) : (
                          <SearchIcon className="h-3 w-3" />
                        )}
                        <span>
                          Searched QCS 2024 knowledge base
                          {hasGraphSources && (
                            <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                              <NetworkIcon className="h-2.5 w-2.5" />
                              Graph +{graphCount}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })()}

                  {qcsSources.length > 0 && (
                    <Sources>
                      <SourcesTrigger count={qcsSources.length}>
                        <span className="font-medium">
                          Used {qcsSources.length} QCS section{qcsSources.length !== 1 ? "s" : ""}
                        </span>
                        <svg className="h-3.5 w-3.5 transition-transform [[data-state=open]_&]:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                      </SourcesTrigger>
                      <SourcesContent>
                        {qcsSources.map((src, idx) => (
                          <Source key={idx} href="#">
                            {src.source === "graph" ? (
                              <NetworkIcon className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                            ) : (
                              <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="text-xs">{src.reference}</span>
                            {src.source === "graph" && (
                              <span className="ml-auto shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                                graph
                              </span>
                            )}
                          </Source>
                        ))}
                      </SourcesContent>
                    </Sources>
                  )}

                  {verdict && (
                    <Badge
                      variant="outline"
                      className={`mb-3 gap-1.5 ${verdict.className}`}
                    >
                      <verdict.icon className="h-3.5 w-3.5" />
                      {verdict.label}
                    </Badge>
                  )}

                  {isLastAssistant && isStreaming ? (
                    fullText ? (
                      <MessageResponse className="agent-response">{fullText}</MessageResponse>
                    ) : (
                      <Shimmer className="w-full">Analyzing submittal...</Shimmer>
                    )
                  ) : fullText ? (
                    <MessageResponse className="agent-response">{fullText}</MessageResponse>
                  ) : (
                    <Shimmer className="w-full">Reviewing submittal against QCS 2024...</Shimmer>
                  )}
                </>
              )}
            </MessageContent>

            {!isUser && fullText && (
              <MessageActions>
                <MessageAction
                  tooltip="Copy"
                  label="Copy response"
                  onClick={() => navigator.clipboard.writeText(fullText)}
                >
                  <ClipboardIcon className="size-3" />
                </MessageAction>
              </MessageActions>
            )}
          </Message>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline attachment button (uses prompt-input context)
// ---------------------------------------------------------------------------

function AttachFileButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      className="size-8 rounded-lg p-0"
      tooltip="Attach files"
      onClick={() => attachments.openFileDialog()}
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
}

// ---------------------------------------------------------------------------
// Inline attachment display for prompt input header
// ---------------------------------------------------------------------------

function PromptAttachments() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;

  return (
    <PromptInputHeader>
      <Attachments variant="inline">
        {files.map((file) => (
          <Attachment key={file.id} data={file} onRemove={() => remove(file.id)}>
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type RagMode = "vector" | "graph";

export default function Home() {
  const [ragMode, setRagMode] = useState<RagMode>("graph");
  const ragModeRef = useRef<RagMode>(ragMode);

  // Keep ref in sync with state
  useEffect(() => {
    ragModeRef.current = ragMode;
  }, [ragMode]);

  // Use a stable transport that reads ragMode from ref
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ ragMode: ragModeRef.current }),
      }),
    []
  );

  const { messages, setMessages, sendMessage, status, stop } = useChat({
    transport,
  });

  const history = useConversationHistory();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Track whether we're switching conversations (skip auto-save during switch)
  const switchingRef = useRef(false);
  // Track previous message count to detect new messages
  const prevMsgCountRef = useRef(0);

  const isLoading = status === "streaming" || status === "submitted";
  const hasMessages = messages.length > 0;

  // Auto-save messages to active conversation
  useEffect(() => {
    if (switchingRef.current) return;
    if (!history.activeId) return;
    if (messages.length === 0) return;
    // Only save when messages actually change
    if (messages.length !== prevMsgCountRef.current || status === "ready") {
      history.updateConversation(history.activeId, messages);
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, status, history.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text || "";
      if (!text.trim() && (!message.files || message.files.length === 0)) return;

      // Create a conversation if none is active
      if (!history.activeId) {
        history.createConversation();
      }

      sendMessage({ text, files: message.files });
    },
    [history.activeId, history, sendMessage]
  );

  const handleSampleClick = useCallback(
    (text: string) => {
      if (isLoading) return;

      if (!history.activeId) {
        history.createConversation();
      }

      sendMessage({ text });
    },
    [isLoading, history.activeId, history, sendMessage]
  );

  const handleNewChat = useCallback(() => {
    if (isLoading) return;
    switchingRef.current = true;
    setMessages([]);
    history.setActiveId(null);
    prevMsgCountRef.current = 0;
    // Allow auto-save again after state settles
    requestAnimationFrame(() => {
      switchingRef.current = false;
    });
  }, [isLoading, setMessages, history]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (isLoading) return;
      if (id === history.activeId) return;
      switchingRef.current = true;
      const msgs = history.selectConversation(id);
      setMessages(msgs ?? []);
      prevMsgCountRef.current = (msgs ?? []).length;
      requestAnimationFrame(() => {
        switchingRef.current = false;
      });
    },
    [isLoading, history, setMessages]
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      const wasActive = id === history.activeId;
      history.deleteConversation(id);
      if (wasActive) {
        switchingRef.current = true;
        setMessages([]);
        prevMsgCountRef.current = 0;
        requestAnimationFrame(() => {
          switchingRef.current = false;
        });
      }
    },
    [history, setMessages]
  );

  // Shared sidebar props
  const sidebarProps = {
    groups: history.groupedConversations,
    activeId: history.activeId,
    onSelect: handleSelectConversation,
    onDelete: handleDeleteConversation,
    onNewChat: handleNewChat,
  };

  return (
    <div className="flex h-dvh bg-background">
      {/* Desktop sidebar */}
      <DesktopSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        {...sidebarProps}
      />

      {/* Mobile sidebar */}
      <MobileSidebar
        open={mobileSheetOpen}
        onOpenChange={setMobileSheetOpen}
        {...sidebarProps}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 flex-none border-b border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              {/* Mobile hamburger */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={() => setMobileSheetOpen(true)}
                aria-label="Open sidebar"
              >
                <MenuIcon className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-3">
                <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-foreground/5 text-foreground">
                  <Image
                    src={BRAND_LOGO_SRC}
                    alt="Construct Bot logo"
                    fill
                    sizes="32px"
                    className="object-contain dark:invert"
                    priority
                  />
                </div>
                <div>
                  <h1 className="text-sm font-semibold leading-tight">
                    Construct Bot
                  </h1>
                  <p className="text-[11px] text-muted-foreground">
                    QCS Review Agent
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] hidden sm:flex font-normal text-muted-foreground">
                4,441 pages indexed
              </Badge>
              {hasMessages && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  disabled={isLoading}
                  aria-label="New chat"
                  className="h-8 w-8"
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="mx-auto max-w-3xl px-4 py-6">
            {!hasMessages ? (
              <div className="flex flex-col items-center justify-center h-full gap-8 px-2">
                <ConversationEmptyState
                  icon={
                    <span className="relative block h-10 w-10 overflow-hidden">
                      <Image
                        src={BRAND_LOGO_SRC}
                        alt="Construct Bot logo"
                        fill
                        sizes="40px"
                        className="object-contain opacity-50 dark:invert"
                      />
                    </span>
                  }
                  title="Construction Submittal Review"
                  description="Paste a material submittal, upload a PDF, or try a sample below."
                />

                <div className="w-full max-w-2xl">
                  <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid sm:grid-cols-2 sm:overflow-x-visible sm:pb-0">
                    {SAMPLE_SUBMITTALS.map((sample) => (
                      <button
                        key={sample.label}
                        type="button"
                        onClick={() => handleSampleClick(sample.text)}
                        className="group flex-none w-[240px] snap-start rounded-lg border border-border/60 p-3 text-left transition-all hover:border-border hover:shadow-sm sm:w-auto sm:flex-auto"
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="mt-0.5 text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">
                            {sample.icon}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{sample.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {sample.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <ChatMessages messages={messages} status={status} />
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input Area */}
        <div className="sticky bottom-0 z-10 flex-none border-t border-border/50 bg-background/80 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-3xl px-4 py-3">
            <PromptInput
              onSubmit={handleSubmit}
              accept="application/pdf,text/plain,.doc,.docx"
              multiple
              maxFileSize={10 * 1024 * 1024}
              globalDrop
            >
              <PromptAttachments />
              <PromptInputTextarea
                placeholder="Describe submittal or upload PDF..."
                disabled={isLoading}
                className="min-h-11"
              />
              <PromptInputTools className="self-end items-center px-2 pb-2">
                <AttachFileButton />
                <Select value={ragMode} onValueChange={(v: RagMode) => setRagMode(v)}>
                  <SelectTrigger className="h-8 w-auto gap-1.5 border-none bg-transparent dark:bg-transparent px-2 text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 focus-visible:border-none focus-visible:ring-0">
                    {ragMode === "vector" ? (
                      <DatabaseIcon className="h-3.5 w-3.5" />
                    ) : (
                      <NetworkIcon className="h-3.5 w-3.5" />
                    )}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" side="top" sideOffset={8} className="max-h-none overflow-visible [&_[data-radix-select-viewport]]:h-auto">
                    <SelectItem value="vector">Vector RAG</SelectItem>
                    <SelectItem value="graph">Graph RAG</SelectItem>
                  </SelectContent>
                </Select>
                <PromptInputSubmit
                  status={status}
                  onStop={stop}
                  className="size-8 rounded-lg p-0 bg-foreground text-background shadow-sm transition-all hover:bg-foreground/90 hover:shadow-md active:scale-95"
                />
              </PromptInputTools>
            </PromptInput>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Reviews submittals against 4,441 pages of QCS 2024 specifications
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
