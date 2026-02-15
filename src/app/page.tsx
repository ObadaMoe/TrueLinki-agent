"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
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
  PromptInput,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  ClipboardIcon,
  FileTextIcon,
  HardHatIcon,
  BuildingIcon,
} from "lucide-react";

const SAMPLE_SUBMITTALS = [
  {
    label: "Cement Submittal",
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

function getVerdictInfo(text: string) {
  const upper = text.toUpperCase();
  if (upper.includes("**APPROVED**") || /VERDICT[:\s]*\n?\s*\*{0,2}APPROVED/.test(upper)) {
    return { label: "APPROVED", color: "bg-green-500/10 text-green-500 border-green-500/20" };
  }
  if (upper.includes("**REJECTED**") || /VERDICT[:\s]*\n?\s*\*{0,2}REJECTED/.test(upper)) {
    return { label: "REJECTED", color: "bg-red-500/10 text-red-500 border-red-500/20" };
  }
  if (upper.includes("NEEDS REVISION")) {
    return { label: "NEEDS REVISION", color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" };
  }
  return null;
}

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
        const toolParts = message.parts.filter((p) => p.type === "tool-invocation");
        const fileParts = message.parts.filter((p) => p.type === "file");
        const verdict = !isUser ? getVerdictInfo(fullText) : null;
        const isLastAssistant =
          !isUser && message.id === messages[messages.length - 1]?.id;

        return (
          <Message key={message.id} from={message.role}>
            {/* Show attached files for user messages */}
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
                  {/* Tool usage indicator */}
                  {toolParts.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-pulse" />
                      Searched QCS 2024 knowledge base ({toolParts.length}{" "}
                      {toolParts.length === 1 ? "query" : "queries"})
                    </div>
                  )}
                  {/* Verdict badge */}
                  {verdict && (
                    <Badge
                      variant="outline"
                      className={`mb-3 ${verdict.color}`}
                    >
                      {verdict.label}
                    </Badge>
                  )}
                  {/* Streaming or static response */}
                  {isLastAssistant && isStreaming ? (
                    <MessageResponse>{fullText}</MessageResponse>
                  ) : fullText ? (
                    <MessageResponse>{fullText}</MessageResponse>
                  ) : (
                    <Shimmer className="w-full">Reviewing submittal against QCS 2024...</Shimmer>
                  )}
                </>
              )}
            </MessageContent>

            {/* Copy action for assistant messages */}
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

export default function Home() {
  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text || "";
    if (!text.trim() && (!message.files || message.files.length === 0)) return;
    sendMessage({ text, files: message.files });
  };

  const handleSampleClick = (text: string) => {
    if (isLoading) return;
    sendMessage({ text });
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex-none border-b bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <HardHatIcon className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                QCS Review Agent
              </h1>
              <p className="text-xs text-muted-foreground">
                Qatar Construction Specifications 2024
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] hidden sm:flex">
              4,441 pages indexed
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="mx-auto max-w-4xl px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-8">
              <ConversationEmptyState
                icon={<HardHatIcon className="h-8 w-8 text-muted-foreground" />}
                title="Construction Submittal Review"
                description="Paste a material submittal, upload a PDF, or try a sample below. The agent reviews against QCS 2024 specifications and provides structured approval or rejection with citations."
              />
              <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SAMPLE_SUBMITTALS.map((sample) => (
                  <Card
                    key={sample.label}
                    className="cursor-pointer transition-all hover:bg-accent/50 hover:shadow-sm"
                    onClick={() => handleSampleClick(sample.text)}
                  >
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="mt-0.5 text-muted-foreground">
                        {sample.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{sample.label}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          Review against QCS 2024
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <ChatMessages messages={messages} status={status} />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input Area */}
      <div className="flex-none border-t bg-card/50 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <PromptInput
            onSubmit={handleSubmit}
            accept="application/pdf,text/plain,.doc,.docx"
            multiple
            maxFileSize={10 * 1024 * 1024}
          >
            <PromptInputTextarea
              placeholder="Describe your construction submittal or upload a PDF..."
              disabled={isLoading}
            />
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputSubmit
                status={status}
                onStop={stop}
              />
            </PromptInputTools>
          </PromptInput>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Reviews submittals against 4,441 pages of QCS 2024 specifications
          </p>
        </div>
      </div>
    </div>
  );
}
