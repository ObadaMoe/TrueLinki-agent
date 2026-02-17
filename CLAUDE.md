# CLAUDE.md

## Project Overview
QCS Submittal Review Agent — an AI-powered app that reviews construction submittals against Qatar Construction Specifications (QCS 2024). Built for a TrueLinks.ai technical evaluation.

**Live**: https://truelink-theta.vercel.app
**Repo**: https://github.com/ObadaMoe/TrueLinki-agent

## Tech Stack
- **Framework**: Next.js 16 (App Router) + TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **AI**: Vercel AI SDK v6 (`ai@6.x`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **LLM**: Google Gemini 2.5 Flash (reasoning + vision) + OpenAI text-embedding-3-small (embeddings only)
- **Vector DB**: Upstash Vector (1536 dims, cosine similarity)
- **Graph Store**: Upstash Redis (concept graph for Graph RAG)
- **Deployment**: Vercel (scope: obada-alhomsis-projects, project: truelink)

## Architecture
```
User submittal → /api/chat → AI SDK streamText (Gemini 2.5 Flash)
                                ↓ tool call
                  analyzeSubmittal → Gemini 2.5 Flash generateObject → structured extraction
                                ↓ tool call
                  retrieveQCSSpecs → embed query (OpenAI) → Upstash Vector + Redis Graph → top-K chunks
                                ↓
                  Gemini 2.5 Flash reasons with analysis + retrieved specs → structured verdict + citations
```

### PDF Processing Pipeline
```
PDF upload → extractPDF (pdfjs-dist)
  ├─ Text-based PDF: extract text + render key pages as JPEG images
  └─ Scanned PDF: skip canvas rendering (garbled for JBIG2/CCITT),
                   send raw PDF base64 to Gemini (native PDF support)
```

## Key Files
- `src/app/api/chat/route.ts` — RAG chat API endpoint (Gemini 2.5 Flash + tools)
- `src/lib/vector-store.ts` — Upstash Vector search + Graph RAG hybrid search (OpenAI embeddings)
- `src/lib/pdf-extract.ts` — PDF text extraction + page image rendering (pdfjs-dist + @napi-rs/canvas)
- `src/lib/submittal-analyzer.ts` — Structured PDF analysis via Gemini 2.5 Flash generateObject
- `src/app/page.tsx` — Main UI (submittal form, sample queries, chat, error handling)
- `src/components/chat-message.tsx` — Message rendering with verdict badges + markdown
- `src/hooks/use-conversation-history.ts` — localStorage conversation persistence (strips binary parts)
- `scripts/ingest-qcs.ts` — PDF parsing script (unpdf, structure-aware chunking)
- `scripts/embed-and-upload.ts` — Embedding generation + Upstash upload (resumable via START_FROM env)

## AI SDK v6 Patterns
- Use `inputSchema` (not `parameters`) in tool definitions
- Use `stopWhen: stepCountIs(N)` (not `maxSteps`) in `streamText`
- Client uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport`
- Error handling: `error` + `regenerate` from `useChat` (not `reload`)
- Tool results stream automatically via `toUIMessageStreamResponse()`
- Google provider: `import { google } from "@ai-sdk/google"` → `google("gemini-2.5-flash")`
- Native PDF support: `FilePart` with `mediaType: "application/pdf"` for scanned docs

## Commands
```bash
# Dev server
npm run dev

# Build
npm run build

# Parse QCS PDF into chunks (one-time, needs data/QCS2024.pdf)
node --max-old-space-size=4096 ./node_modules/.bin/tsx scripts/ingest-qcs.ts

# Embed and upload to Upstash (resumable)
node --env-file=.env.local ./node_modules/.bin/tsx scripts/embed-and-upload.ts

# Resume from chunk N
START_FROM=10000 node --env-file=.env.local ./node_modules/.bin/tsx scripts/embed-and-upload.ts

# Deploy to Vercel
vercel --prod
```

## Environment Variables
Required in `.env.local` (and Vercel dashboard for production):
- `GOOGLE_GENERATIVE_AI_API_KEY` — Google AI API key (Gemini, primary LLM)
- `OPENAI_API_KEY` — OpenAI API key (embeddings only)
- `UPSTASH_VECTOR_REST_URL` — Upstash Vector endpoint
- `UPSTASH_VECTOR_REST_TOKEN` — Upstash Vector auth token
- `UPSTASH_REDIS_REST_URL` — Upstash Redis endpoint (graph store)
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis auth token

## Data Files (gitignored)
- `data/QCS2024.pdf` — 61MB, 4441 pages source PDF
- `data/qcs-chunks.json` — Parsed chunks with metadata

## Knowledge Base Status
- 16,546 total chunks parsed from QCS2024.pdf
- 10,000 chunks uploaded to Upstash (Sections 1-11 covered)
- Remaining 6,546 can be uploaded by running embed script with `START_FROM=10000`

## Known Issues & Decisions
- **pdfjs-dist canvas rendering**: Produces garbled images for scanned PDFs with JBIG2/CCITT compression. Solution: send raw PDF to Gemini which handles PDFs natively.
- **localStorage quota**: Conversations with large PDF base64 data exceeded ~5-10MB limit. Solution: `stripBinaryParts()` filters file parts and truncates large text before storage.
- **Model choice**: Switched from OpenAI GPT-4o to Google Gemini 2.5 Flash due to OpenAI Tier 1 rate limits (30K TPM). Gemini offers 4M TPM on pay-as-you-go, better vision, and is 25x cheaper.

## Deploy Workflow
```
git commit → git push origin claude/gracious-hamilton
cd /Users/obada/Desktop/Projects/truelinki-agent
git checkout main && git merge claude/gracious-hamilton --no-edit && git push origin main
vercel --prod
```
