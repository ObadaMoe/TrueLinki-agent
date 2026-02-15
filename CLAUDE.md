# CLAUDE.md

## Project Overview
QCS Submittal Review Agent — an AI-powered app that reviews construction submittals against Qatar Construction Specifications (QCS 2024). Built for a TrueLinks.ai technical evaluation.

**Live**: https://truelink-theta.vercel.app
**Repo**: https://github.com/ObadaMoe/TrueLinki-agent

## Tech Stack
- **Framework**: Next.js 16 (App Router) + TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **AI**: Vercel AI SDK v6 (`ai@6.x`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **LLM**: OpenAI GPT-4o (reasoning) + text-embedding-3-small (embeddings)
- **Vector DB**: Upstash Vector (1536 dims, cosine similarity)
- **Deployment**: Vercel (scope: obada-alhomsis-projects, project: truelink)

## Architecture
```
User submittal → /api/chat → AI SDK streamText (GPT-4o)
                                ↓ tool call
                          retrieveQCSSpecs → embed query → Upstash Vector → top-K chunks
                                ↓
                          GPT-4o reasons with retrieved specs → structured verdict + citations
```

## Key Files
- `src/app/api/chat/route.ts` — RAG chat API endpoint
- `src/lib/vector-store.ts` — Upstash Vector search (embed query + similarity search)
- `src/app/page.tsx` — Main UI (submittal form, sample queries, chat)
- `src/components/chat-message.tsx` — Message rendering with verdict badges + markdown
- `scripts/ingest-qcs.ts` — PDF parsing script (unpdf, structure-aware chunking)
- `scripts/embed-and-upload.ts` — Embedding generation + Upstash upload (resumable via START_FROM env)

## AI SDK v6 Patterns
- Use `inputSchema` (not `parameters`) in tool definitions
- Use `stopWhen: stepCountIs(N)` (not `maxSteps`) in `streamText`
- Client uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport`
- Tool results stream automatically via `toUIMessageStreamResponse()`

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
- `OPENAI_API_KEY` — OpenAI API key
- `UPSTASH_VECTOR_REST_URL` — Upstash Vector endpoint
- `UPSTASH_VECTOR_REST_TOKEN` — Upstash Vector auth token

## Data Files (gitignored)
- `data/QCS2024.pdf` — 61MB, 4441 pages source PDF
- `data/qcs-chunks.json` — Parsed chunks with metadata

## Knowledge Base Status
- 16,546 total chunks parsed from QCS2024.pdf
- 10,000 chunks uploaded to Upstash (Sections 1-11 covered)
- Remaining 6,546 can be uploaded by running embed script with `START_FROM=10000`
