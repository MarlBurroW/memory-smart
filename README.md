# memory-smart

OpenClaw plugin for intelligent long-term memory with LLM-based fact extraction, composite scoring, and Qdrant vector storage.

## Features

- **Auto-capture**: Extracts important facts from conversations using a lightweight LLM (gpt-4.1-nano)
- **Auto-recall**: Injects relevant memories into context at session start
- **Composite scoring**: Ranks memories by vector similarity (35%) + importance (30%) + recency (20%) + access frequency (15%)
- **Qdrant backend**: Fast vector search with REST API (no SDK dependency)
- **Safety**: Prompt injection detection, XML escaping, dedup, user-only capture

## Prerequisites

- [Qdrant](https://qdrant.tech/) running (default: `http://localhost:6333`)
- OpenAI API key (for embeddings + extraction)

## Setup

1. Plugin is auto-discovered from `~/.openclaw/extensions/memory-smart/`

2. Install dependencies:
```bash
cd ~/.openclaw/extensions/memory-smart
npm install --ignore-scripts
```

3. Add to `openclaw.json`:
```json5
{
  plugins: {
    slots: {
      memory: "memory-smart"
    },
    entries: {
      "memory-smart": {
        enabled: true,
        config: {
          qdrant: {
            url: "http://localhost:6333",
            collection: "memory-smart"
          },
          embedding: {
            apiKey: "sk-...",
            model: "text-embedding-3-small"
          },
          extraction: {
            apiKey: "sk-...",
            model: "gpt-4.1-nano"
          },
          autoCapture: true,
          autoRecall: true,
          recallLimit: 5,
          captureMaxPerTurn: 5,
          decayDays: 365
        }
      }
    }
  }
}
```

4. Restart OpenClaw gateway.

## Agent Tools

- `memory_recall` — Search memories by query
- `memory_store` — Manually store a fact
- `memory_forget` — Delete by ID or search query

## How It Works

### Auto-Capture (after each turn)
1. Extract user messages from conversation
2. Filter out noise (too short, too long, prompt injection)
3. Send to LLM for structured fact extraction (category + importance)
4. Embed facts → dedup check (similarity > 0.92) → store in Qdrant

### Auto-Recall (before each turn)
1. Embed the user's prompt
2. Vector search in Qdrant (top N × 2 candidates)
3. Apply composite scoring (vector + importance + recency + access)
4. Inject top N memories as `<relevant-memories>` context
5. Bump access counters

## License

MIT
