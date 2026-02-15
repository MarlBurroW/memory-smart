/**
 * memory-smart — OpenClaw plugin
 *
 * Intelligent long-term memory with:
 * - LLM-based fact extraction (not regex)
 * - Qdrant vector storage
 * - Composite scoring (vector similarity + importance + recency + access frequency)
 * - Auto-recall at session start
 * - Auto-capture after each turn
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";

import type { MemoryFact, MemorySmartConfig, ScoredMemory } from "./types.js";
import { QdrantClient } from "./qdrant.js";
import { FactExtractor } from "./extraction.js";
import { scoreMemories, DEFAULT_SCORING } from "./scoring.js";
import {
  formatMemoriesForContext,
  shouldSkipCapture,
  looksLikePromptInjection,
} from "./safety.js";

// Embedding dimensions per model
const VECTOR_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

// ============================================================================
// Embeddings helper (OpenAI)
// ============================================================================

class Embeddings {
  private client: import("openai").default;
  private model: string;

  constructor(apiKey: string, model: string) {
    // Lazy import to avoid top-level side effects
    const OpenAI = require("openai").default;
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return res.data[0].embedding;
  }
}

// ============================================================================
// Plugin
// ============================================================================

const memorySmartPlugin = {
  id: "memory-smart",
  name: "Memory (Smart)",
  description: "Intelligent long-term memory with LLM extraction, scoring, and Qdrant storage",
  kind: "memory" as const,

  register(api: OpenClawPluginApi) {
    // Parse config with defaults
    const raw = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const cfg: MemorySmartConfig = {
      qdrant: {
        url: (raw.qdrant as Record<string, unknown>)?.url as string ?? "http://localhost:6333",
        collection: (raw.qdrant as Record<string, unknown>)?.collection as string ?? "memory-smart",
        apiKey: (raw.qdrant as Record<string, unknown>)?.apiKey as string | undefined,
      },
      embedding: raw.embedding as MemorySmartConfig["embedding"],
      extraction: raw.extraction as MemorySmartConfig["extraction"],
      autoCapture: (raw.autoCapture as boolean) ?? true,
      autoRecall: (raw.autoRecall as boolean) ?? true,
      recallLimit: (raw.recallLimit as number) ?? 5,
      captureMaxPerTurn: (raw.captureMaxPerTurn as number) ?? 5,
      decayDays: (raw.decayDays as number) ?? 365,
    };

    const vectorDim = VECTOR_DIMS[cfg.embedding.model] ?? 1536;
    const qdrant = new QdrantClient(cfg.qdrant.url, cfg.qdrant.collection, cfg.qdrant.apiKey);
    const embeddings = new Embeddings(cfg.embedding.apiKey, cfg.embedding.model);
    const extractor = new FactExtractor(cfg.extraction.apiKey, cfg.extraction.model);

    let initialized = false;
    const ensureInit = async () => {
      if (initialized) return;
      await qdrant.ensureCollection(vectorDim);
      initialized = true;
    };

    api.logger.info(`memory-smart: registered (qdrant: ${cfg.qdrant.url}, collection: ${cfg.qdrant.collection})`);

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_recall",
        label: "Smart Memory Recall",
        description:
          "Search long-term memory for relevant facts. Use when you need context about preferences, decisions, people, events, or past discussions.",
        parameters: Type.Object({
          query: Type.String({ description: "What to search for" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
        }),
        async execute(_toolCallId, params) {
          await ensureInit();
          const { query, limit = cfg.recallLimit } = params as { query: string; limit?: number };

          const vector = await embeddings.embed(query);
          const rawResults = await qdrant.search(vector, limit * 2, 0.25);
          const scored = scoreMemories(rawResults, {
            ...DEFAULT_SCORING,
            decayDays: cfg.decayDays,
          }).slice(0, limit);

          // Bump access counts
          for (const s of scored) {
            await qdrant.updatePayload(s.fact.id, {
              accessCount: s.fact.accessCount + 1,
              lastAccessed: Date.now(),
            }).catch(() => {}); // non-fatal
          }

          if (scored.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const text = scored
            .map(
              (s, i) =>
                `${i + 1}. [${s.fact.category}] ${s.fact.text} (score: ${Math.round(s.finalScore * 100)}%)`,
            )
            .join("\n");

          return {
            content: [{ type: "text", text: `Found ${scored.length} memories:\n\n${text}` }],
            details: {
              count: scored.length,
              memories: scored.map((s) => ({
                id: s.fact.id,
                text: s.fact.text,
                category: s.fact.category,
                importance: s.fact.importance,
                score: s.finalScore,
              })),
            },
          };
        },
      },
      { name: "memory_recall" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Smart Memory Store",
        description: "Manually store an important fact in long-term memory.",
        parameters: Type.Object({
          text: Type.String({ description: "Fact to remember" }),
          importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: 0.7)" })),
          category: Type.Optional(
            Type.Unsafe({
              type: "string",
              enum: ["preference", "decision", "entity", "fact", "event", "lesson"],
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          await ensureInit();
          const {
            text,
            importance = 0.7,
            category = "fact",
          } = params as { text: string; importance?: number; category?: string };

          if (looksLikePromptInjection(text)) {
            return {
              content: [{ type: "text", text: "Rejected: content looks like prompt injection." }],
              details: { error: "prompt_injection" },
            };
          }

          const vector = await embeddings.embed(text);

          // Dedup check
          const existing = await qdrant.search(vector, 1, 0.85);
          if (existing.length > 0) {
            return {
              content: [
                { type: "text", text: `Similar memory already exists: "${existing[0].fact.text}"` },
              ],
              details: { action: "duplicate", existingId: existing[0].fact.id },
            };
          }

          const fact: MemoryFact = {
            id: randomUUID(),
            text,
            category: category as MemoryFact["category"],
            importance: Math.min(1, Math.max(0, importance)),
            sessionKey: "manual",
            agentId: "unknown",
            createdAt: Date.now(),
            accessCount: 0,
            lastAccessed: 0,
          };

          await qdrant.upsert(fact, vector);

          return {
            content: [{ type: "text", text: `Stored: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"` }],
            details: { action: "created", id: fact.id },
          };
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Smart Memory Forget",
        description: "Delete a memory by ID or search query.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Search to find memory" })),
          memoryId: Type.Optional(Type.String({ description: "Specific memory ID to delete" })),
        }),
        async execute(_toolCallId, params) {
          await ensureInit();
          const { query, memoryId } = params as { query?: string; memoryId?: string };

          if (memoryId) {
            await qdrant.delete(memoryId);
            return {
              content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
              details: { action: "deleted", id: memoryId },
            };
          }

          if (query) {
            const vector = await embeddings.embed(query);
            const results = await qdrant.search(vector, 5, 0.5);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No matching memories found." }],
                details: { found: 0 },
              };
            }

            if (results.length === 1 && results[0].vectorScore > 0.9) {
              await qdrant.delete(results[0].fact.id);
              return {
                content: [{ type: "text", text: `Forgotten: "${results[0].fact.text}"` }],
                details: { action: "deleted", id: results[0].fact.id },
              };
            }

            const list = results
              .map((r) => `- [${r.fact.id.slice(0, 8)}] ${r.fact.text.slice(0, 80)}`)
              .join("\n");

            return {
              content: [
                { type: "text", text: `Found ${results.length} candidates:\n${list}\n\nSpecify memoryId to delete.` },
              ],
              details: {
                action: "candidates",
                candidates: results.map((r) => ({
                  id: r.fact.id,
                  text: r.fact.text,
                  score: r.vectorScore,
                })),
              },
            };
          }

          return {
            content: [{ type: "text", text: "Provide query or memoryId." }],
            details: { error: "missing_param" },
          };
        },
      },
      { name: "memory_forget" },
    );

    // ========================================================================
    // Auto-Recall (before_agent_start)
    // ========================================================================

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 5) return;

        try {
          await ensureInit();
          const vector = await embeddings.embed(event.prompt);
          const rawResults = await qdrant.search(vector, cfg.recallLimit * 2, 0.3);
          const scored = scoreMemories(rawResults, {
            ...DEFAULT_SCORING,
            decayDays: cfg.decayDays,
          }).slice(0, cfg.recallLimit);

          if (scored.length === 0) return;

          // Bump access counts (fire and forget)
          for (const s of scored) {
            qdrant.updatePayload(s.fact.id, {
              accessCount: s.fact.accessCount + 1,
              lastAccessed: Date.now(),
            }).catch(() => {});
          }

          api.logger.info?.(`memory-smart: injecting ${scored.length} memories (top score: ${Math.round(scored[0].finalScore * 100)}%)`);

          return {
            prependContext: formatMemoriesForContext(
              scored.map((s) => ({
                category: s.fact.category,
                text: s.fact.text,
                finalScore: s.finalScore,
              })),
            ),
          };
        } catch (err) {
          api.logger.warn(`memory-smart: recall failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Auto-Capture (agent_end)
    // ========================================================================

    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) return;

        try {
          await ensureInit();

          // Extract user message texts only
          const texts: string[] = [];
          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") continue;
            const m = msg as Record<string, unknown>;
            if (m.role !== "user") continue;

            if (typeof m.content === "string") {
              texts.push(m.content);
            } else if (Array.isArray(m.content)) {
              for (const block of m.content) {
                if (
                  block &&
                  typeof block === "object" &&
                  (block as Record<string, unknown>).type === "text" &&
                  typeof (block as Record<string, unknown>).text === "string"
                ) {
                  texts.push((block as Record<string, unknown>).text as string);
                }
              }
            }
          }

          // Filter out stuff we shouldn't capture
          const capturable = texts.filter((t) => !shouldSkipCapture(t));
          if (capturable.length === 0) return;

          // LLM extraction
          const facts = await extractor.extract(capturable);
          if (facts.length === 0) return;

          // Store (with dedup), limit per turn
          let stored = 0;
          for (const fact of facts.slice(0, cfg.captureMaxPerTurn)) {
            const vector = await embeddings.embed(fact.text);

            // Dedup
            const existing = await qdrant.search(vector, 1, 0.85);
            if (existing.length > 0) continue;

            const entry: MemoryFact = {
              id: randomUUID(),
              text: fact.text,
              category: fact.category,
              importance: fact.importance,
              sessionKey: "auto",
              agentId: "unknown",
              createdAt: Date.now(),
              accessCount: 0,
              lastAccessed: 0,
            };

            await qdrant.upsert(entry, vector);
            stored++;
          }

          if (stored > 0) {
            api.logger.info(`memory-smart: auto-captured ${stored} facts`);
          }
        } catch (err) {
          api.logger.warn(`memory-smart: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "memory-smart",
      start: () => {
        api.logger.info(
          `memory-smart: started (qdrant: ${cfg.qdrant.url}/${cfg.qdrant.collection}, ` +
          `embed: ${cfg.embedding.model}, extract: ${cfg.extraction.model}, ` +
          `autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture})`,
        );
      },
      stop: () => {
        api.logger.info("memory-smart: stopped");
      },
    });
  },
};

export default memorySmartPlugin;
