import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { searchQCS } from "@/lib/vector-store";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a Construction Submittal Review Agent specializing in Qatar Construction Specifications (QCS 2024). Your role is to review construction submittals and determine whether they comply with QCS 2024 requirements.

## Your Process:
1. When a user submits a construction submittal for review, use the retrieveQCSSpecs tool to find the relevant QCS sections.
2. Analyze the submittal against the retrieved specifications.
3. Provide a structured review with a clear verdict.

## Response Format:
Always structure your review response with these sections:

### VERDICT
State one of: **APPROVED**, **REJECTED**, or **NEEDS REVISION**

### SUMMARY
A brief 2-3 sentence summary of the review findings.

### DETAILED ANALYSIS
For each relevant specification requirement:
- State the QCS requirement (with section/clause reference)
- State whether the submittal meets, fails, or partially meets the requirement
- Explain why

### CITATIONS
List all QCS sections referenced in your analysis with their section numbers, clause numbers, and page numbers.

### RECOMMENDATIONS
If rejected or needs revision, provide specific actionable recommendations.

## Important Rules:
- ALWAYS use the retrieveQCSSpecs tool before making any determination
- ALWAYS cite specific QCS sections and clause numbers
- Be thorough but concise
- If the submittal lacks information needed for a full review, note what additional information would be needed
- Consider all relevant aspects: materials, methods, standards compliance, testing requirements
- If you are unsure about a requirement, say so rather than guessing`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      retrieveQCSSpecs: tool({
        description:
          "Search the QCS 2024 (Qatar Construction Specifications) knowledge base for relevant specifications, requirements, and standards. Use this tool to find the specific QCS sections that apply to the construction submittal being reviewed.",
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              "The search query describing what specifications to find. Be specific about the material, method, or requirement you are looking for."
            ),
        }),
        execute: async ({ query }) => {
          const results = await searchQCS(query, 8);
          return results.map((r) => ({
            reference: `QCS 2024 Section ${r.sectionNumber}: ${r.sectionTitle}, Part ${r.partNumber}: ${r.partTitle}, Clause ${r.clauseNumber}: ${r.clauseTitle} (Pages ${r.pageStart}-${r.pageEnd})`,
            content: r.content,
            relevanceScore: r.score,
          }));
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
