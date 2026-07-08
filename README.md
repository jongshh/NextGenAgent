# NextGenAgent

Next-Gen Super Agent for Student.

This repository contains the MVP for a counseling-style AI super agent. The first milestone implements the `pathfinder` agent: `길을 찾는 사람 - 나는 무엇을 선택해야 할까?`.

## Structure

- `apps/web`: React/Vite chat interface.
- `apps/worker`: Cloudflare Worker API that calls OpenAI Responses API.
- `packages/agents`: Shared agent definitions and prompt policy.
- `packages/rag`: RAG data schema, local retrieval helpers, and PDF processing scripts.
- `data/processed`: Normalized chunks extracted from `DB/Interview_DB1.pdf`.

## Setup

```powershell
npm install
npm run process:interview-db
```

Create `apps/worker/.dev.vars`:

```env
OPENAI_API_KEY=sk-...
OPENAI_VECTOR_STORE_ID=vs_...
OPENAI_MODEL=gpt-5.5
ALLOWED_ORIGIN=http://localhost:5173
```

Run the UI and Worker in separate terminals:

```powershell
npm run dev:web
npm run dev:worker
```

The web app expects the Worker at `http://localhost:8787` unless `VITE_WORKER_URL` is set.
