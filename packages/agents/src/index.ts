import { DEFAULT_PROMPT_SETTINGS } from './prompts';
export type AgentId = "pathfinder" | "creator" | "thinker" | "connector";

export interface AgentConfig {
  id: AgentId;
  title: string;
  question: string;
  active: boolean;
  retrievalTags: string[];
  tone: string;
  openingPrompt: string;
  openingChoices: [string, string, string];
}

export { COMMON_SUPER_AGENT_SYSTEM_PROMPT } from './common';
export { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings, renderPrompt, type PromptSettings } from './prompts';

export const AGENTS: Record<AgentId, AgentConfig> = {
  pathfinder: {
    id: "pathfinder",
    title: "길을 찾는 사람",
    question: "나는 무엇을 선택해야 할까?",
    active: true,
    retrievalTags: ["선택", "진로 전환", "실패 극복", "장기 관점", "동료/환경 선택"],
    tone: DEFAULT_PROMPT_SETTINGS.agents.pathfinder.personality,
    openingPrompt:
      "어서 와요. 지금 갈림길에 서 있다면, 내가 먼저 헤맸던 이야기부터 꺼내볼게요.",
    openingChoices: [
      "졸업을 앞두고 무엇을 준비할지 막막해요.",
      "안정적인 길과 하고 싶은 일 사이에서 고민해요.",
      "실패가 많아 시작하기 늦은 것 같아요."
    ]
  },
  creator: {
    id: "creator",
    title: "창작하는 사람",
    question: "계속 창작할 수 있을까?",
    active: true,
    retrievalTags: ["창작", "완벽주의", "실패", "반복 개선", "자기 회복"],
    tone: DEFAULT_PROMPT_SETTINGS.agents.creator.personality,
    openingPrompt: "창작이 멈춘 것처럼 느껴질 때에도, 멈춤 안에는 보통 다음 재료가 있습니다.",
    openingChoices: [
      "만들고 싶은데 자꾸 시작을 미루게 돼요.",
      "내게 재능이 있는지 자꾸 의심하게 돼요.",
      "완성한 작업이 마음에 들지 않아 지쳐요."
    ]
  },
  thinker: {
    id: "thinker",
    title: "생각하는 사람",
    question: "어떻게 살아야 할까?",
    active: true,
    retrievalTags: ["삶의 태도", "철학", "책임", "장기 관점", "가치관"],
    tone: DEFAULT_PROMPT_SETTINGS.agents.thinker.personality,
    openingPrompt: "삶의 방식은 정답보다 반복해서 돌아갈 기준에 가깝습니다.",
    openingChoices: [
      "내가 중요하게 여기는 것이 무엇인지 모르겠어요.",
      "잘 사는 삶의 기준을 어디에서 찾아야 할까요?",
      "불안과 비교에서 조금 벗어나고 싶어요."
    ]
  },
  connector: {
    id: "connector",
    title: "용기있는 사람",
    question: "두려워도 한 걸음 나아갈 수 있을까?",
    active: true,
    retrievalTags: ["도전", "용기", "준비", "두려움", "실패 극복"],
    tone: DEFAULT_PROMPT_SETTINGS.agents.connector.personality,
    openingPrompt: "나도 첫걸음 앞에서는 두려웠어요. 함께 준비하면 조금씩 나아갈 수 있습니다.",
    openingChoices: [
      "도전하고 싶지만 실패가 두려워요.",
      "어려운 목표를 어떻게 준비해야 할까요?",
      "포기하고 싶을 때 다시 나아갈 힘을 찾고 싶어요."
    ]
  }
};

export function getAgentConfig(agentId: AgentId): AgentConfig {
  return AGENTS[agentId];
}

export function isAgentId(value: string): value is AgentId {
  return value in AGENTS;
}
