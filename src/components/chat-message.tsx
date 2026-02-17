"use client";

import type { UIMessage } from "ai";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";

function getVerdictBadge(text: string) {
  const upper = text.toUpperCase();
  if (upper.includes("**APPROVED**") || upper.includes("### VERDICT\nAPPROVED") || upper.includes("VERDICT: APPROVED")) {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-300 hover:bg-green-100">
        APPROVED
      </Badge>
    );
  }
  if (upper.includes("**REJECTED**") || upper.includes("### VERDICT\nREJECTED") || upper.includes("VERDICT: REJECTED")) {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100">
        REJECTED
      </Badge>
    );
  }
  if (
    upper.includes("**NEEDS REVISION**") ||
    upper.includes("NEEDS REVISION")
  ) {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100">
        REJECTED
      </Badge>
    );
  }
  return null;
}

function getBorderColor(text: string) {
  const upper = text.toUpperCase();
  if (upper.includes("**APPROVED**") || upper.includes("VERDICT: APPROVED") || upper.includes("### VERDICT\nAPPROVED")) {
    return "border-l-green-500";
  }
  if (upper.includes("**REJECTED**") || upper.includes("VERDICT: REJECTED") || upper.includes("### VERDICT\nREJECTED")) {
    return "border-l-red-500";
  }
  if (upper.includes("NEEDS REVISION")) {
    return "border-l-red-500";
  }
  return "border-l-blue-500";
}

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  // Collect all text parts
  const fullText = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");

  // Check for tool invocations
  const toolParts = message.parts.filter((p) => p.type === "tool-invocation");

  if (isUser) {
    return (
      <Card className="border-l-4 border-l-primary bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="text-xs">
              Submittal
            </Badge>
          </div>
          <pre className="whitespace-pre-wrap text-sm font-mono">
            {fullText}
          </pre>
        </CardContent>
      </Card>
    );
  }

  // Assistant message
  const verdictBadge = getVerdictBadge(fullText);
  const borderColor = getBorderColor(fullText);

  return (
    <div className="space-y-2">
      {/* Show tool usage indicator */}
      {toolParts.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-4">
          <div className="h-2 w-2 bg-blue-500 rounded-full" />
          Retrieved {toolParts.length} QCS specification
          {toolParts.length > 1 ? " queries" : " query"} from knowledge base
        </div>
      )}

      <Card className={`border-l-4 ${borderColor}`}>
        <CardContent className="p-4">
          {verdictBadge && <div className="mb-3">{verdictBadge}</div>}
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1 prose-li:my-0.5 prose-ul:my-1">
            <ReactMarkdown>{fullText}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
