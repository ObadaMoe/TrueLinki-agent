"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/chat-message";

const SAMPLE_SUBMITTALS = [
  {
    label: "Cement Submittal",
    text: `MATERIAL SUBMITTAL - Portland Cement

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
    text: `SUBMITTAL - Concrete Mix Design

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
    text: `MATERIAL SUBMITTAL - Waterproofing System

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
    text: `MATERIAL SUBMITTAL - Steel Reinforcement

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

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    sendMessage({ text: inputValue });
    setInputValue("");
  };

  const handleSampleClick = (text: string) => {
    if (isLoading) return;
    sendMessage({
      text: `Please review the following construction submittal against QCS 2024 requirements:\n\n${text}`,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              QCS Submittal Review Agent
            </h1>
            <p className="text-sm text-muted-foreground">
              AI-powered construction submittal review based on Qatar
              Construction Specifications 2024
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            QCS 2024 Knowledge Base
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        {/* Chat Messages */}
        {messages.length > 0 ? (
          <ScrollArea className="mb-6">
            <div className="space-y-4 pb-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading &&
                messages[messages.length - 1]?.role === "user" && (
                  <Card className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                        Analyzing submittal against QCS 2024 specifications...
                      </div>
                    </CardContent>
                  </Card>
                )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        ) : (
          /* Welcome / Sample Submittals */
          <div className="mb-6">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>How It Works</CardTitle>
                <CardDescription>
                  Submit a construction material or method submittal, and the
                  agent will review it against QCS 2024 specifications. The agent
                  retrieves relevant sections from the 4,400+ page QCS document
                  and provides a structured approval or rejection with specific
                  citations.
                </CardDescription>
              </CardHeader>
            </Card>

            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Try a sample submittal:
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SAMPLE_SUBMITTALS.map((sample) => (
                <Card
                  key={sample.label}
                  className="cursor-pointer transition-colors hover:bg-accent"
                  onClick={() => handleSampleClick(sample.text)}
                >
                  <CardContent className="p-4">
                    <p className="font-medium text-sm">{sample.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {sample.text.substring(0, 120)}...
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <Separator className="mb-6" />

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Paste your construction submittal here for review against QCS 2024 specifications... Include material details, manufacturer info, standards, test results, etc."
            className="min-h-[120px] resize-y"
            disabled={isLoading}
          />
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              The agent searches the QCS 2024 knowledge base (4,441 pages) to
              ground its review in actual specifications.
            </p>
            <Button type="submit" disabled={isLoading || !inputValue.trim()}>
              {isLoading ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Reviewing...
                </>
              ) : (
                "Review Submittal"
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
