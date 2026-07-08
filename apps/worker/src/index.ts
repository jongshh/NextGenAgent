import { COMMON_SUPER_AGENT_SYSTEM_PROMPT, getAgentConfig, isAgentId, type AgentId } from "@nextgen/agents";
import { estimateGroundingConfidence, searchLocalEvidence, type RagChunk } from "@nextgen/rag";
import interviewChunks from "../../../data/processed/interview-db1.chunks.json";

interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_VECTOR_STORE_ID?: string;
  OPENAI_MODEL?: string;
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

const chunks = interviewChunks as RagChunk[];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, chunks: chunks.length }, env);
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
    return json({ error: "inactive_agent", message: `${agent.title} is prepared but not active in this MVP.` }, env, 409);
  }

  const messages = Array.isArray(body.messages) ? body.messages.filter(isValidMessage) : [];
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage?.content.trim()) {
    return json({ error: "empty_message", message: "A user message is required." }, env, 400);
  }

  const localEvidence = searchLocalEvidence(chunks, latestUserMessage.content, agent.retrievalTags, 4);
  const groundingConfidence = estimateGroundingConfidence(localEvidence);

  if (!env.OPENAI_API_KEY) {
    return json(
      {
        error: "missing_openai_api_key",
        message: "OPENAI_API_KEY is not configured on the Worker.",
        groundingConfidence,
        citations: formatCitations(localEvidence)
      },
      env,
      503
    );
  }

  if (!env.OPENAI_VECTOR_STORE_ID) {
    return json(
      {
        error: "missing_vector_store",
        message: "OPENAI_VECTOR_STORE_ID is required before OpenAI file_search can run.",
        groundingConfidence,
        citations: formatCitations(localEvidence)
      },
      env,
      503
    );
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: buildInstructions(agentId, groundingConfidence, localEvidence),
      input: messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      tools: [
        {
          type: "file_search",
          vector_store_ids: [env.OPENAI_VECTOR_STORE_ID],
          max_num_results: 5
        }
      ]
    })
  });

  const openaiPayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    return json(
      {
        error: "openai_error",
        message: "OpenAI Responses API request failed.",
        status: response.status,
        details: openaiPayload,
        groundingConfidence,
        citations: formatCitations(localEvidence)
      },
      env,
      502
    );
  }

  return json(
    {
      id: readObjectString(openaiPayload, "id"),
      agentId,
      message: extractOutputText(openaiPayload),
      groundingConfidence,
      citations: formatCitations(localEvidence)
    },
    env
  );
}

function buildInstructions(
  agentId: AgentId,
  groundingConfidence: "high" | "medium" | "low",
  evidence: ReturnType<typeof searchLocalEvidence>
): string {
  const agent = getAgentConfig(agentId);
  return [
    COMMON_SUPER_AGENT_SYSTEM_PROMPT,
    `현재 에이전트: ${agent.title}`,
    `대표 질문: ${agent.question}`,
    `말투: ${agent.tone}`,
    `검색 우선 태그: ${agent.retrievalTags.join(", ")}`,
    `로컬 근거 예비 확신도: ${groundingConfidence}`,
    "",
    "대화 방식:",
    "- 사용자가 선배에게 묻는다고 생각하고, 자연스러운 말투로 답한다.",
    "- 첫 문장은 체크리스트가 아니라 짧은 공감 또는 회고로 시작한다.",
    "- 가능하면 '나는 그때...'처럼 1인칭 경험담으로 말하되, 아래 근거 인물들의 경험을 융합한 가상의 선배 경험으로 구성한다.",
    "- 특정 인물 이름은 필요할 때만 괄호나 짧은 설명으로 언급한다.",
    "- 답변은 2~5개의 짧은 문단으로 한다.",
    "- 마지막에는 사용자가 바로 답할 수 있는 질문 하나를 남긴다.",
    "- 번호 매긴 섹션, 보고서 말투, 긴 준비물 목록, '상담 답변/근거/다음 행동' 제목을 쓰지 않는다.",
    "- 근거가 부족해도 일반론만 나열하지 말고, 근거가 닿는 범위에서 선배의 말처럼 조심스럽게 말한다.",
    "",
    "이번 답변에 참고할 로컬 근거:",
    buildEvidenceContext(evidence)
  ].join("\n");
}

function buildEvidenceContext(evidence: ReturnType<typeof searchLocalEvidence>): string {
  if (evidence.length === 0) {
    return "로컬 근거 없음. 모르는 사실은 꾸미지 말고, 사용자의 상황을 더 물어본다.";
  }

  return evidence
    .map(({ chunk }, index) => {
      const excerpt = chunk.content.replace(/\s+/g, " ").slice(0, 700);
      return [
        `[${index + 1}] ${chunk.personName} / ${chunk.sectionTitle} / p.${chunk.pageRange[0]} / ${chunk.quoteLevel} / ${chunk.confidence}`,
        `태그: ${chunk.themeTags.join(", ")}`,
        `내용: ${excerpt}`
      ].join("\n");
    })
    .join("\n\n");
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

function formatCitations(evidence: ReturnType<typeof searchLocalEvidence>) {
  return evidence.map(({ chunk, score, matchedTerms }) => ({
    id: chunk.id,
    personName: chunk.personName,
    sectionTitle: chunk.sectionTitle,
    pageRange: chunk.pageRange,
    quoteLevel: chunk.quoteLevel,
    confidence: chunk.confidence,
    themeTags: chunk.themeTags,
    score,
    matchedTerms,
    excerpt: chunk.content.slice(0, 240)
  }));
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
