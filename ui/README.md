# 🧠 Memory Explorer

Web UI for the memory-smart OpenClaw plugin. Browse, search, and manage memories stored in Qdrant.

## Setup

```bash
cd ~/.openclaw/extensions/memory-smart/ui
OPENAI_API_KEY=sk-... node server.mjs
```

Open http://localhost:3460 (default credentials: admin/admin).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_UI_PORT` | `3460` | Server port |
| `MEMORY_UI_USER` | `admin` | Basic auth username |
| `MEMORY_UI_PASS` | `admin` | Basic auth password |
| `OPENAI_API_KEY` | — | **Required** for semantic search (text-embedding-3-small) |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | `memory-smart` | Collection name |

## Features

- Browse all memories with pagination
- Filter by category (fact, decision, preference, entity, event, lesson)
- Semantic search via OpenAI embeddings
- Delete memories
- View detailed memory info in modal
- Dark theme, responsive design
- Zero dependencies (native Node.js)
