import { COMMON_SUPER_AGENT_SYSTEM_PROMPT, getAgentConfig, isAgentId, type AgentId } from "@nextgen/agents";
import {
  estimateGroundingConfidence,
  mergeSemanticEvidence,
  searchLocalEvidence,
  type RagChunk,
  type RetrievedEvidence
} from "@nextgen/rag";
import interviewChunks from "../../../data/processed/interview-db1.chunks.json";

interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_VECTOR_STORE_ID?: string;
  OPENAI_MODEL?: string;
  OPENAI_MODERATION_MODEL?: string;
  ALLOWED_ORIGIN?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  agentId?: string;
  messages?: ChatMessage[];
  sessionId?: string;
}

type Mood = "neutral" | "reflective" | "encouraging";
type SafetyStatus = "allowed" | "redirected" | "blocked";

interface ModelScene {
  text: string;
  mood: Mood;
  portraitVariant: Mood;
  choices: string[];
  evidenceIds: string[];
}

interface VectorSearchResult {
  score?: number;
  content?: Array<{ type?: string; text?: string }>;
}

const chunks = interviewChunks as RagChunk[];
const MAX_HISTORY_MESSAGES = 14;
const MAX_MESSAGE_LENGTH = 2400;

const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    mood: { type: "string", enum: ["neutral", "reflective", "encouraging"] },
    portraitVariant: { type: "string", enum: ["neutral", "reflective", "encouraging"] },
    choices: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" }
    },
    evidenceIds: {
      type: "array",
      maxItems: 5,
      items: { type: "string" }
    }
  },
  required: ["text", "mood", "portraitVariant", "choices", "evidenceIds"]
} as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json(
        {
          ok: true,
          chunks: chunks.length,
          reviewed: chunks.filter((chunk) => chunk.reviewStatus === "verified").length,
          needsReview: chunks.filter((chunk) => chunk.reviewStatus === "needs_review").length
        },
        env
      );
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    return json({ error: "not_found", message: "Unknown endpoint." }, env, 404);
  }
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, env, 400);
  }

  const agentId = normalizeAgentId(body.agentId);
  if (!agentId) {
    return json({ error: "invalid_agent", message: "Only configured agent IDs are accepted." }, env, 400);
  }

  const agent = getAgentConfig(agentId);
  if (!agent.active) {
    return json({ error: "inactive_agent", message: `${agent.title} is not active yet.` }, env, 409);
  }

  const messages = normalizeMessages(body.messages);
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) {
    return json({ error: "empty_message", message: "A user message is required." }, env, 400);
  }

  if (!env.OPENAI_API_KEY) {
    return sceneError(
      env,
      "missing_openai_api_key",
      "OPENAI_API_KEY가 아직 Worker에 연결되지 않았어요. 설정을 확인한 뒤 다시 이야기해 주세요.",
      503
    );
  }

  if (!env.OPENAI_VECTOR_STORE_ID) {
    return sceneError(
      env,
      "missing_vector_store",
      "상담 기록 저장소가 아직 연결되지 않았어요. OPENAI_VECTOR_STORE_ID 설정을 확인해 주세요.",
      503
    );
  }

  const inputModeration = await moderateText(latestUserMessage.content, env);
  if (inputModeration?.flagged) {
    const isSelfHarm = hasSelfHarmSignal(inputModeration.categories);
    return json(
      buildSafetyResponse(isSelfHarm ? "redirected" : "blocked", isSelfHarm),
      env,
      200
    );
  }

  const localEvidence = searchLocalEvidence(chunks, latestUserMessage.content, agent.retrievalTags, 8);
  const semanticMatches = await searchVectorStore(latestUserMessage.content, env);
  const evidence = mergeSemanticEvidence(chunks, localEvidence, semanticMatches, 5);
  const groundingConfidence = estimateGroundingConfidence(evidence);
  const insufficientEvidence = evidence.length < 2 || groundingConfidence === "low";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: buildInstructions(agentId, groundingConfidence, evidence),
      input: messages,
      safety_identifier: await createSafetyIdentifier(body.sessionId),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "mentor_scene",
          strict: true,
          schema: SCENE_SCHEMA
        }
      }
    })
  });

  const openaiPayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    return sceneError(
      env,
      "openai_error",
      "잠시 생각을 정리하지 못했어요. 같은 이야기를 한 번만 더 들려줄래요?",
      502,
      groundingConfidence,
      formatCitations(evidence)
    );
  }

  const scene = parseModelScene(extractOutputText(openaiPayload), agent.title, evidence);
  if (!scene) {
    return sceneError(
      env,
      "invalid_model_response",
      "말을 고르다 잠시 멈췄어요. 방금 질문을 다시 보내주면 이어서 답할게요.",
      502,
      groundingConfidence,
      formatCitations(evidence)
    );
  }

  const outputModeration = await moderateText([scene.text, ...scene.choices].join("\n"), env);
  if (outputModeration?.flagged) {
    return json(buildSafetyResponse("blocked", false), env, 200);
  }

  const allowedEvidenceIds = new Set(evidence.map((item) => item.chunk.id));
  const usedEvidence = scene.evidenceIds
    .filter((id) => allowedEvidenceIds.has(id))
    .map((id) => evidence.find((item) => item.chunk.id === id))
    .filter((item): item is RetrievedEvidence => Boolean(item));
  const citations = formatCitations(usedEvidence.length > 0 ? usedEvidence : evidence.slice(0, 2));

  return json(
    {
      id: readObjectString(openaiPayload, "id"),
      agentId,
      message: scene.text,
      scene: {
        speaker: agent.title,
        text: scene.text,
        mood: scene.mood,
        portraitVariant: scene.portraitVariant,
        choices: scene.choices.map((label, index) => ({
          id: `choice-${index + 1}`,
          label
        }))
      },
      groundingConfidence,
      insufficientEvidence,
      citations,
      safety: { status: "allowed" satisfies SafetyStatus }
    },
    env
  );
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isValidMessage)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_MESSAGE_LENGTH)
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
}

async function searchVectorStore(
  query: string,
  env: Env
): Promise<Array<{ text: string; score: number }>> {
  if (!env.OPENAI_API_KEY || !env.OPENAI_VECTOR_STORE_ID) return [];

  try {
    const response = await fetch(
      `https://api.openai.com/v1/vector_stores/${encodeURIComponent(env.OPENAI_VECTOR_STORE_ID)}/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query,
          max_num_results: 6,
          rewrite_query: true
        })
      }
    );

    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: VectorSearchResult[] };
    return (payload.data || [])
      .map((item) => ({
        score: typeof item.score === "number" ? item.score : 0,
        text: (item.content || [])
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n")
      }))
      .filter((item) => item.text.length > 0);
  } catch {
    return [];
  }
}

async function moderateText(
  input: string,
  env: Env
): Promise<{ flagged: boolean; categories: Record<string, boolean> } | null> {
  if (!env.OPENAI_API_KEY) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODERATION_MODEL || "omni-moderation-latest",
        input
      })
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
    };
    const result = payload.results?.[0];
    return result
      ? {
          flagged: result.flagged === true,
          categories: result.categories || {}
        }
      : null;
  } catch {
    return null;
  }
}

function hasSelfHarmSignal(categories: Record<string, boolean>): boolean {
  return Object.entries(categories).some(([key, value]) => value && key.startsWith("self-harm"));
}

function buildSafetyResponse(status: SafetyStatus, isSelfHarm: boolean) {
  const text = isSelfHarm
    ? "지금은 선배처럼 경험담을 이어가기보다 당신의 안전을 먼저 확인하고 싶어요. 당장 자신을 다칠 가능성이 있다면 혼자 있지 말고, 가까운 사람에게 지금 상태를 알린 뒤 지역 긴급 서비스나 응급실의 도움을 받아 주세요. 지금 곁에 연락할 수 있는 사람이 있나요?"
    : "이 공간은 배우고 고민을 나누기 위한 곳이라 그 표현 그대로는 이어가기 어려워요. 같은 고민을 안전하고 존중하는 말로 바꾸어 들려주면 함께 생각해볼게요.";

  return {
    message: text,
    scene: {
      speaker: "AI 선배",
      text,
      mood: "reflective" as const,
      portraitVariant: "reflective" as const,
      choices: isSelfHarm
        ? [
            { id: "choice-1", label: "지금 연락할 수 있는 사람을 떠올려볼게요." },
            { id: "choice-2", label: "당장 위험한 상황인지 먼저 말해볼게요." },
            { id: "choice-3", label: "전문적인 도움을 받는 방법을 찾고 싶어요." }
          ]
        : [
            { id: "choice-1", label: "표현을 바꾸어 다시 물어볼게요." },
            { id: "choice-2", label: "왜 그런 생각이 들었는지 말해볼게요." },
            { id: "choice-3", label: "다른 주제로 이야기할게요." }
          ]
    },
    groundingConfidence: "low" as const,
    insufficientEvidence: true,
    citations: [],
    safety: { status }
  };
}

function buildInstructions(
  agentId: AgentId,
  groundingConfidence: "high" | "medium" | "low",
  evidence: RetrievedEvidence[]
): string {
  const agent = getAgentConfig(agentId);
  const verifiedEvidenceCount = evidence.filter(
    ({ chunk }) => chunk.reviewStatus === "verified" && chunk.confidence !== "low"
  ).length;
  return [
    COMMON_SUPER_AGENT_SYSTEM_PROMPT,
    "",
    `현재 선배: ${agent.title}`,
    `대표 질문: ${agent.question}`,
    `대화 성격: ${agent.tone}`,
    `검색 근거 확신도: ${groundingConfidence}`,
    `검증 완료 근거 수: ${verifiedEvidenceCount}`,
    "",
    "대화 목표:",
    "- 사용자가 챗봇의 보고서가 아니라 조금 먼저 헤매본 선배와 마주 앉아 있다고 느끼게 한다.",
    "- 첫 문장은 사용자의 구체적인 상황을 받아주거나 짧은 회고로 시작한다.",
    "- 답변은 2~4개의 짧은 문단으로 이루어진 하나의 자연스러운 대화문이다.",
    "- 목록, 번호, 섹션 제목, 준비물 체크리스트를 사용하지 않는다.",
    "- 근거가 충분하면 여러 기록의 공통 패턴을 '나도 그 무렵...' 같은 합성된 선배 경험으로 풀 수 있다.",
    "- 특정 실존 인물의 고유 사건을 자신의 실제 경험이라고 주장하지 않는다.",
    "- confidence가 low인 근거는 경험담, 수치, 직접 인용에 사용하지 않는다.",
    "- reviewStatus가 needs_review인 자료는 따옴표 인용하거나 자신의 과거 경험처럼 말하지 않고, '기록 속 사람들은...'처럼 일반화된 패턴으로만 사용한다.",
    verifiedEvidenceCount === 0
      ? "- 검증 완료 근거가 없으므로 '나도', '나는 그때', '내 경험에는' 같은 직접 체험형 회고를 절대 사용하지 않는다."
      : "- 합성된 1인칭 회고는 검증 완료 근거에 공통으로 존재하는 패턴 안에서만 사용한다.",
    "- 근거가 부족하면 일반론을 꾸미지 말고 사용자의 상황을 좁히는 질문을 중심에 둔다.",
    "- 마지막 문장을 질문형으로 끝내지 않아도 된다. 후속 대화는 choices에 둔다.",
    "",
    "선택지 규칙:",
    "- 정확히 3개를 만든다.",
    "- 사용자가 실제로 말할 법한 1인칭 한국어 문장으로 쓴다.",
    "- 순서대로 현재 고민 구체화, 자기 상황 성찰, 다른 관점 또는 다음 행동을 다룬다.",
    "- 서로 중복하지 않고 각 문장은 45자 안팎으로 간결하게 쓴다.",
    "",
    "근거 사용 규칙:",
    "- 아래 evidence 블록만 구체적인 인물·사건·발언의 사실 근거로 사용한다.",
    "- 실제로 답변을 구성하는 데 사용한 evidence id만 evidenceIds에 넣는다.",
    "- id를 새로 만들거나 블록에 없는 id를 반환하지 않는다.",
    "",
    buildEvidenceContext(evidence)
  ].join("\n");
}

function buildEvidenceContext(evidence: RetrievedEvidence[]): string {
  if (evidence.length === 0) {
    return "<evidence>검색된 근거 없음</evidence>";
  }

  const entries = evidence.map(({ chunk }) => {
    const excerpt = chunk.content.replace(/\s+/g, " ").slice(0, 850);
    return [
      `<source id="${chunk.id}" person="${chunk.personName}" page="${chunk.pageRange[0]}"`,
      ` quoteLevel="${chunk.quoteLevel}" confidence="${chunk.confidence}" reviewStatus="${chunk.reviewStatus}">`,
      excerpt,
      "</source>"
    ].join("");
  });

  return `<evidence>\n${entries.join("\n")}\n</evidence>`;
}

export function parseModelScene(rawText: string, speaker: string, evidence: RetrievedEvidence[]): ModelScene | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<ModelScene>;
    const mood = isMood(parsed.mood) ? parsed.mood : "reflective";
    const portraitVariant = isMood(parsed.portraitVariant) ? parsed.portraitVariant : mood;
    const choices = sanitizeChoices(parsed.choices);
    if (typeof parsed.text !== "string" || parsed.text.trim().length === 0) return null;

    const allowedIds = new Set(evidence.map((item) => item.chunk.id));
    const evidenceIds = Array.isArray(parsed.evidenceIds)
      ? parsed.evidenceIds.filter((id): id is string => typeof id === "string" && allowedIds.has(id))
      : [];

    return {
      text: neutralizeUnverifiedExperience(parsed.text.trim(), evidence),
      mood,
      portraitVariant,
      choices,
      evidenceIds
    };
  } catch {
    return null;
  }
}

export function neutralizeUnverifiedExperience(
  text: string,
  evidence: RetrievedEvidence[]
): string {
  const hasVerifiedEvidence = evidence.some(
    ({ chunk }) => chunk.reviewStatus === "verified" && chunk.confidence !== "low"
  );
  if (hasVerifiedEvidence) return text;

  return text
    .replace(/나도\s*/g, "내가 살펴본 기록 속 사람들도 ")
    .replace(/나 역시\s*/g, "기록 속 사람들 역시 ")
    .replace(/나는 그때\s*/g, "기록 속 사람들은 그때 ")
    .replace(/내 경험(?:에는|에선|에서는)?/g, "내가 살펴본 기록에서는");
}

export function sanitizeChoices(value: unknown): string[] {
  const defaults = [
    "내 상황을 조금 더 구체적으로 말해볼게요.",
    "내가 가장 두려워하는 선택부터 살펴볼래요.",
    "지금 할 수 있는 작은 행동을 함께 찾고 싶어요."
  ];
  if (!Array.isArray(value)) return defaults;

  const unique = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 80))
        .filter(Boolean)
    )
  );

  return unique.length === 3 ? unique : defaults;
}

function isMood(value: unknown): value is Mood {
  return value === "neutral" || value === "reflective" || value === "encouraging";
}

function normalizeAgentId(agentId: string | undefined): AgentId | null {
  if (!agentId || !isAgentId(agentId)) return null;
  return agentId;
}

function isValidMessage(message: unknown): message is ChatMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as ChatMessage;
  return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = record.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const text = (contentItem as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
  }

  return parts.join("\n").trim();
}

function readObjectString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function formatCitations(evidence: RetrievedEvidence[]) {
  return evidence.map(({ chunk, score, matchedTerms }) => ({
    id: chunk.id,
    personName: chunk.personName,
    sectionTitle: chunk.sectionTitle,
    pageRange: chunk.pageRange,
    quoteLevel: chunk.quoteLevel,
    confidence: chunk.confidence,
    reviewStatus: chunk.reviewStatus,
    sourceTitle: chunk.sourceTitle,
    sourceUrl: chunk.sourceUrl,
    themeTags: chunk.themeTags,
    score,
    matchedTerms,
    excerpt: chunk.content.slice(0, 260)
  }));
}

async function createSafetyIdentifier(sessionId: string | undefined): Promise<string> {
  const source = sessionId?.trim() || "anonymous-nextgen-session";
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `nga_${Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function sceneError(
  env: Env,
  error: string,
  text: string,
  status: number,
  groundingConfidence: "high" | "medium" | "low" = "low",
  citations: ReturnType<typeof formatCitations> = []
): Response {
  return json(
    {
      error,
      message: text,
      scene: {
        speaker: "AI 선배",
        text,
        mood: "reflective",
        portraitVariant: "reflective",
        choices: [
          { id: "choice-1", label: "방금 질문을 다시 보내볼게요." },
          { id: "choice-2", label: "조금 다르게 표현해볼게요." },
          { id: "choice-3", label: "처음부터 새로 이야기할게요." }
        ]
      },
      groundingConfidence,
      insufficientEvidence: true,
      citations,
      safety: { status: "allowed" }
    },
    env,
    status
  );
}

function json(value: unknown, env: Env, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}
