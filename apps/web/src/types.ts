import type { AgentId } from "@nextgen/agents";

export type Mood = "neutral" | "reflective" | "encouraging";

export interface Choice {
  id: string;
  label: string;
}

export interface Citation {
  id: string;
  personName: string;
  sectionTitle: string;
  pageRange: [number, number];
  quoteLevel: string;
  confidence: string;
  reviewStatus?: "verified" | "needs_review" | "excluded";
  sourceTitle?: string;
  sourceUrl?: string;
  themeTags: string[];
  excerpt: string;
}

export interface ChatScene {
  speaker: string;
  text: string;
  mood: Mood;
  portraitVariant: Mood;
  choices: Choice[];
}

export interface ChatResponse {
  id?: string | null;
  message?: string;
  error?: string;
  scene?: ChatScene;
  groundingConfidence?: "high" | "medium" | "low";
  insufficientEvidence?: boolean;
  citations?: Citation[];
  safety?: {
    status: "allowed" | "redirected" | "blocked";
  };
}

export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  scene?: ChatScene;
  groundingConfidence?: "high" | "medium" | "low";
  insufficientEvidence?: boolean;
  citations?: Citation[];
  safetyStatus?: "allowed" | "redirected" | "blocked";
}

export interface ConversationSession {
  id: string;
  agentId: AgentId;
  turns: ConversationTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionData {
  version: 1;
  sessions: Partial<Record<AgentId, ConversationSession>>;
  lastAgentId?: AgentId;
}
