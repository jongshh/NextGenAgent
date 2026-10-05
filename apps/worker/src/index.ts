import { AGENTS, COMMON_SUPER_AGENT_SYSTEM_PROMPT, getAgentConfig, isAgentId, type AgentId } from "@nextgen/agents";
import {
  estimateGroundingConfidence,
  mergeSemanticEvidence,
  searchLocalEvidence,
  type RagChunk,
  type RetrievedEvidence
} from "@nextgen/rag";
import dbBundle from "../../../data/processed/db-bundle.json";
const dbManifest = dbBundle.manifest;
import { handleVoiceRoute } from "./voice";

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_VECTOR_STORE_ID?: string;
  OPENAI_DB_VERSION?: string;
  NEXTGEN_INSTANCE_ID?: string;
  OPENAI_MODEL?: string;
  OPENAI_MODERATION_MODEL?: string;
  SUPABASE_FUNCTIONS_URL?: string;
  NEXTGEN_PROXY_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  OPENAI_LIVE_MODEL?: string;
  VOICE_ENABLED?: string;
  VOICE_ADMIN_PASSWORD?: string;
  VOICE_ADMIN_SESSION_SECRET?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  agentId?: string;
  messages?: ChatMessage[];
  sessionId?: string;
  conversationId?: string;
  turnId?: string;
  inputMode?: "text" | "voice";
}

interface SessionRequest {
  participantId?: string;
  sessionData?: unknown;
}

type Mood = "neutral" | "reflective" | "encouraging";
type SafetyStatus = "allowed" | "redirected" | "blocked";

export type EmotionTag = "sad" | "anxious" | "confused" | "calm" | "hopeful" | "happy" | "neutral";
export type IntentTag = "empathize" | "encourage" | "celebrate" | "reflect" | "guide" | "ground";
export type LightIntensity = "low" | "gentle" | "standard";

export interface LightCue {
  preset: `${EmotionTag}-${IntentTag}`;
  durationMs: number;
  intensity: LightIntensity;
}

interface ModelScene {
  text: string;
  mood: Mood;
  portraitVariant: Mood;
  emotionTag: EmotionTag;
  intentTag: IntentTag;
  choices: string[];
  evidenceIds: string[];
}

interface VectorSearchResult {
  score?: number;
  content?: Array<{ type?: string; text?: string }>;
}

const chunks = dbBundle.chunks as RagChunk[];
const MAX_HISTORY_MESSAGES = 14;
const MAX_MESSAGE_LENGTH = 2400;

const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    mood: { type: "string", enum: ["neutral", "reflective", "encouraging"] },
    portraitVariant: { type: "string", enum: ["neutral", "reflective", "encouraging"] },
    emotionTag: {
      type: "string",
      enum: ["sad", "anxious", "confused", "calm", "hopeful", "happy", "neutral"]
    },
    intentTag: {
      type: "string",
      enum: ["empathize", "encourage", "celebrate", "reflect", "guide", "ground"]
    },
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
  required: ["text", "mood", "portraitVariant", "emotionTag", "intentTag", "choices", "evidenceIds"]
} as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const voiceResponse = await handleVoiceRoute(request, env, url);
    if (voiceResponse) return voiceResponse;

    if (url.pathname.startsWith("/api/") && !isAllowedRequestOrigin(request, env, url)) {
      return new Response(JSON.stringify({ error: "origin_not_allowed", message: "Origin is not allowed." }), {
        status: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: requestCorsHeaders(request, env, url) });
    }

    if (url.pathname === "/api/health") {
      return withRequestCors(json(
        {
          ok: true,
          project: "nextgenagent",
          instanceId: env.NEXTGEN_INSTANCE_ID || null,
          dbVersion: dbManifest.version,
          chunks: chunks.length,
          reviewed: chunks.filter((chunk) => chunk.reviewStatus === "verified").length,
          needsReview: chunks.filter((chunk) => chunk.reviewStatus === "needs_review").length,
          byAgent: Object.fromEntries(
            Object.keys(AGENTS).map((agentId) => [
              agentId,
              chunks.filter((chunk) => chunk.agentIds.includes(agentId)).length
            ])
          ),
          supabaseProxy: hasSupabaseProxy(env)
        },
        env
      ), request, env, url);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return withRequestCors(await handleChat(request, env), request, env, url);
    }

    if (url.pathname === "/api/session/load" && request.method === "POST") {
      return withRequestCors(await handleSession(request, env, "load"), request, env, url);
    }

    if (url.pathname === "/api/session/save" && request.method === "POST") {
      return withRequestCors(await handleSession(request, env, "save"), request, env, url);
    }

    return withRequestCors(
      json({ error: "not_found", message: "Unknown endpoint." }, env, 404),
      request,
      env,
      url
    );
  }
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const probe = await request.clone().json().catch(() => null) as ChatRequest | null;
  const cache = await chatIdempotencyCache();
  const cacheKey = probe?.inputMode === "voice" && probe.conversationId && probe.turnId
    ? new Request(`https://chat-idempotency.invalid/${encodeURIComponent(probe.conversationId)}/${encodeURIComponent(probe.turnId)}`)
    : null;
  if (cache && cacheKey) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  const response = await handleChatCore(request, env);
  if (cache && cacheKey && response.ok) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set("Cache-Control", "max-age=3600");
    await cache.put(cacheKey, stored);
  }
  return response;
}

async function handleChatCore(request: Request, env: Env): Promise<Response> {
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

  if (!hasOpenAIBackend(env)) {
    return sceneError(
      env,
      "missing_openai_api_key",
      "AI 연결 정보가 아직 서버에 설정되지 않았어요. Supabase Secret 설정을 확인해 주세요.",
      503
    );
  }

  if (!hasVectorBackend(env)) {
    return sceneError(
      env,
      "missing_vector_store",
      "상담 기록 저장소가 아직 연결되지 않았어요. Supabase의 Vector Store 설정을 확인해 주세요.",
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

  const agentChunks = chunks.filter((chunk) => chunk.agentIds.includes(agentId));
  const localEvidence = searchLocalEvidence(agentChunks, latestUserMessage.content, agent.retrievalTags, 8);
  const semanticMatches = await searchVectorStore(latestUserMessage.content, agentId, env);
  const evidence = mergeSemanticEvidence(agentChunks, localEvidence, semanticMatches, 5);
  const groundingConfidence = estimateGroundingConfidence(evidence);
  const insufficientEvidence = evidence.length < 2 || groundingConfidence === "low";

  const response = await callOpenAI("responses", {
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
    }, env);

  const openaiPayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    console.error(JSON.stringify({
      message: "OpenAI Responses request failed",
      status: response.status,
      upstreamError: readUpstreamError(openaiPayload)
    }));
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
  const lightCue = buildLightCue(scene.text, scene.emotionTag, scene.intentTag);

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
        emotionTag: scene.emotionTag,
        intentTag: scene.intentTag,
        emotionTags: [scene.emotionTag, scene.intentTag],
        lightCue,
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

async function chatIdempotencyCache(): Promise<Cache | null> {
  return typeof caches === "undefined" ? null : caches.open("nextgen-voice-chat-idempotency");
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

export async function searchVectorStore(
  query: string,
  agentId: AgentId,
  env: Env
): Promise<Array<{ text: string; score: number }>> {
  if (!hasVectorBackend(env)) return [];

  try {
    const response = await callOpenAI("vector_search", {
      query,
      max_num_results: 6,
      rewrite_query: true,
      filters: { type: "and", filters: [
        { type: "eq", key: "agent_id", value: agentId },
        { type: "eq", key: "db_version", value: dbManifest.version }
      ] }
    }, env);

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
  if (!hasOpenAIBackend(env)) return null;

  try {
    const response = await callOpenAI("moderations", {
      model: env.OPENAI_MODERATION_MODEL || "omni-moderation-latest",
      input
    }, env);

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
      emotionTag: isSelfHarm ? "calm" as const : "neutral" as const,
      intentTag: isSelfHarm ? "ground" as const : "reflect" as const,
      emotionTags: isSelfHarm ? ["calm", "ground"] as const : ["neutral", "reflect"] as const,
      lightCue: isSelfHarm ? buildLightCue(text, "calm", "ground", "low") : null,
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
    "- 첫 문장은 사용자의 말에 바로 반응하거나 '나도 그랬어요' 같은 짧은 자기 경험으로 시작한다.",
    "- 답변은 4~7개의 짧은 문장으로 쓴다. 한 문장에는 한 가지 생각만 담는다.",
    "- 잘 다듬어진 상담 칼럼보다 실제 사람이 잠시 생각하며 말하는 구어체를 우선한다.",
    "- 목록, 번호, 섹션 제목, 준비물 체크리스트를 사용하지 않는다.",
    "- 검색된 여러 삶의 공통 경험은 이 선배 자신의 융합된 기억이다. '나도 그 무렵...'처럼 1인칭으로 말한다.",
    evidence.length > 0
      ? "- 이번 답변에는 반드시 '나도', '나는', '내가', '내 경험에는' 중 하나를 사용한 1인칭 경험 문장을 한 문장 이상 넣는다."
      : "- 검색 근거가 없으므로 경험을 지어내지 말고, 사람답게 반응한 뒤 사용자의 상황을 더 묻는다.",
    "- 특정 실존 인물의 고유 사건을 자신의 실제 경험이라고 주장하지 않는다.",
    "- confidence가 low인 근거는 구체적인 사건, 수치, 고유명사, 직접 인용에 사용하지 않는다.",
    "- reviewStatus가 needs_review인 자료도 공통된 감정·고민·선택 방식은 자신의 경험으로 말할 수 있지만, 구체적 사실이나 인용으로 확대하지 않는다.",
    verifiedEvidenceCount === 0
      ? "- 검증 완료 근거가 없으므로 구체적인 인물·시기·장소·수치 없이, 검색 근거에 공통된 경험의 결만 1인칭으로 말한다."
      : "- 구체적인 회고는 검증 완료 근거에 실제로 존재하는 범위 안에서만 말한다.",
    "- 대화 본문에서 '기록 속', '자료에 따르면', '데이터를 보면', '내가 살펴본 기록'이라는 말을 절대 사용하지 않는다.",
    "- 근거가 부족하면 일반론을 꾸미지 말고 사용자의 상황을 좁히는 질문을 중심에 둔다.",
    "- 마지막 문장을 질문형으로 끝내지 않아도 된다. 후속 대화는 choices에 둔다.",
    "",
    "감정 태그 규칙:",
    "- emotionTag는 응답이 공감하고 있는 사용자의 주된 정서 하나를 고른다.",
    "- intentTag는 선배가 이번 답변에서 취한 주된 대화 의도 하나를 고른다.",
    "- 감정 태그만 반환하며 색상, 밝기, 점멸 또는 장치 명령은 만들지 않는다.",
    "- 슬픔을 알아차리고 용기를 북돋는 답변이라면 emotionTag=sad, intentTag=encourage로 분류한다.",
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
    const emotionTag = isEmotionTag(parsed.emotionTag) ? parsed.emotionTag : moodToEmotion(mood);
    const intentTag = isIntentTag(parsed.intentTag) ? parsed.intentTag : moodToIntent(mood);
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
      emotionTag,
      intentTag,
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
  if (evidence.length > 0) return text;

  return text
    .replace(/나도\s*/g, "그 마음은 ")
    .replace(/나 역시\s*/g, "그럴 때는 ")
    .replace(/나는 그때\s*/g, "그런 순간에는 ")
    .replace(/내 경험(?:에는|에선|에서는)?/g, "이럴 때는");
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

function isEmotionTag(value: unknown): value is EmotionTag {
  return value === "sad" || value === "anxious" || value === "confused" || value === "calm" ||
    value === "hopeful" || value === "happy" || value === "neutral";
}

function isIntentTag(value: unknown): value is IntentTag {
  return value === "empathize" || value === "encourage" || value === "celebrate" ||
    value === "reflect" || value === "guide" || value === "ground";
}

function moodToEmotion(mood: Mood): EmotionTag {
  if (mood === "encouraging") return "hopeful";
  if (mood === "reflective") return "calm";
  return "neutral";
}

function moodToIntent(mood: Mood): IntentTag {
  if (mood === "encouraging") return "encourage";
  if (mood === "reflective") return "reflect";
  return "guide";
}

export function estimateLightDuration(text: string): number {
  const visibleCharacters = text.replace(/\s/g, "").length;
  return Math.max(3000, Math.min(8000, 2000 + Math.ceil(visibleCharacters / 40) * 1000));
}

export function buildLightCue(
  text: string,
  emotionTag: EmotionTag,
  intentTag: IntentTag,
  intensity: LightIntensity = "gentle"
): LightCue {
  return {
    preset: `${emotionTag}-${intentTag}`,
    durationMs: estimateLightDuration(text),
    intensity
  };
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

function readUpstreamError(payload: unknown): { code: string | null; type: string | null; message: string | null } {
  if (!payload || typeof payload !== "object") {
    return { code: null, type: null, message: null };
  }

  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") {
    return { code: null, type: null, message: null };
  }

  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : null,
    type: typeof record.type === "string" ? record.type : null,
    message: typeof record.message === "string" ? record.message.slice(0, 500) : null
  };
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
        emotionTag: "neutral",
        intentTag: "reflect",
        emotionTags: ["neutral", "reflect"],
        lightCue: null,
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

function hasSupabaseProxy(env: Env): boolean {
  return Boolean(env.SUPABASE_FUNCTIONS_URL?.trim() && env.NEXTGEN_PROXY_SECRET?.trim());
}

function hasOpenAIBackend(env: Env): boolean {
  return hasSupabaseProxy(env) || Boolean(env.OPENAI_API_KEY?.trim());
}

function hasVectorBackend(env: Env): boolean {
  return hasSupabaseProxy(env) || Boolean(env.OPENAI_API_KEY?.trim() && env.OPENAI_VECTOR_STORE_ID?.trim());
}

async function handleSession(
  request: Request,
  env: Env,
  action: "load" | "save"
): Promise<Response> {
  let body: SessionRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, env, 400);
  }

  if (typeof body.participantId !== "string" || body.participantId.trim().length === 0) {
    return json({ error: "invalid_participant_id", message: "참여 ID를 확인해 주세요." }, env, 400);
  }

  if (!hasSupabaseProxy(env)) {
    return json(
      action === "load"
        ? { found: false, sessionData: { version: 1, sessions: {} }, cloud: false }
        : { ok: true, cloud: false },
      env
    );
  }

  try {
    const response = await invokeSupabaseFunction("session-api", {
      action,
      participantId: body.participantId,
      ...(action === "save" ? { sessionData: body.sessionData } : {})
    }, env);
    const payload = await response.text();
    return new Response(payload, {
      status: response.status,
      headers: {
        ...corsHeaders(env),
        "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8"
      }
    });
  } catch {
    return json(
      { error: "session_service_unavailable", message: "세션 저장소에 연결하지 못했어요." },
      env,
      503
    );
  }
}

async function callOpenAI(
  operation: "moderations" | "vector_search" | "responses",
  payload: unknown,
  env: Env
): Promise<Response> {
  if (hasSupabaseProxy(env)) {
    return invokeSupabaseFunction("openai-proxy", { operation, payload }, env);
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const endpoint = operation === "vector_search"
    ? `https://api.openai.com/v1/vector_stores/${env.OPENAI_VECTOR_STORE_ID}/search`
    : `https://api.openai.com/v1/${operation}`;

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function invokeSupabaseFunction(
  functionName: "session-api" | "openai-proxy" | "voice-profile-api",
  payload: unknown,
  env: Env
): Promise<Response> {
  const baseUrl = env.SUPABASE_FUNCTIONS_URL?.trim().replace(/\/$/, "");
  const proxySecret = env.NEXTGEN_PROXY_SECRET?.trim();
  if (!baseUrl || !proxySecret) throw new Error("Supabase proxy is not configured.");

  return fetch(`${baseUrl}/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nextgen-proxy-secret": proxySecret
    },
    body: JSON.stringify(payload)
  });
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
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Credentials": "true"
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isAllowedRequestOrigin(request: Request, env: Env, requestUrl: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  const configuredOrigins = (env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (origin === requestUrl.origin || configuredOrigins.includes(origin) || configuredOrigins.includes("*")) {
    return true;
  }

  if (!isLoopbackHostname(requestUrl.hostname)) return false;

  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "http:" && isLoopbackHostname(originUrl.hostname);
  } catch {
    return false;
  }
}

function requestCorsHeaders(request: Request, env: Env, requestUrl: URL): Headers {
  const headers = new Headers(corsHeaders(env));
  const origin = request.headers.get("Origin");

  if (origin && isAllowedRequestOrigin(request, env, requestUrl)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Vary", "Origin");
  return headers;
}

function withRequestCors(response: Response, request: Request, env: Env, requestUrl: URL): Response {
  const headers = new Headers(response.headers);
  requestCorsHeaders(request, env, requestUrl).forEach((value, name) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
