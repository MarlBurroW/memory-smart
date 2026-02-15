/**
 * memory-smart type definitions
 */

// ============================================================================
// Config
// ============================================================================

export interface MemorySmartConfig {
  qdrant: {
    url: string;
    collection: string;
    apiKey?: string;
  };
  embedding: {
    apiKey: string;
    model: "text-embedding-3-small" | "text-embedding-3-large";
  };
  extraction: {
    apiKey: string;
    model: string;
  };
  autoCapture: boolean;
  autoRecall: boolean;
  recallLimit: number;
  captureMaxPerTurn: number;
  decayDays: number;
}

// ============================================================================
// Memory entries
// ============================================================================

export type FactCategory = "preference" | "decision" | "entity" | "fact" | "event" | "lesson";

export interface MemoryFact {
  /** Unique ID (UUID) */
  id: string;
  /** The fact text (human-readable) */
  text: string;
  /** Category detected by LLM */
  category: FactCategory;
  /** LLM-assigned importance 0-1 */
  importance: number;
  /** Source session key */
  sessionKey: string;
  /** Agent ID that created this memory */
  agentId: string;
  /** Timestamp of creation */
  createdAt: number;
  /** Number of times this memory was recalled */
  accessCount: number;
  /** Last time this memory was recalled */
  lastAccessed: number;
}

// ============================================================================
// LLM extraction output
// ============================================================================

export interface ExtractedFact {
  text: string;
  category: FactCategory;
  importance: number;
}

// ============================================================================
// Scored search result
// ============================================================================

export interface ScoredMemory {
  fact: MemoryFact;
  /** Raw vector similarity score (0-1) */
  vectorScore: number;
  /** Final composite score after decay/access boost */
  finalScore: number;
}
