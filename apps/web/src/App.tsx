import { useEffect, useRef, useState } from "react";
import { AGENTS, type AgentId } from "@nextgen/agents";
import { MentorHub } from "./components/MentorHub";
import { ConversationStage } from "./components/ConversationStage";
import { ConversationStageB } from "./components/ConversationStageB";
import { SessionGate } from "./components/SessionGate";
import { HueControl } from "./components/HueControl";
import { VoiceControl } from "./components/VoiceControl";
import {
  deriveLightCue,
  createVoiceHueMeter,
  isHueCompanionHost,
  loadHueEffectsEnabled,
  playAssistantOutput,
  readHueStatus,
  saveHueEffectsEnabled,
  stopHueEffects,
  type HueConnectionState
} from "./hue";
import {
  hasLocalSessions,
  loadAllSessions,
  loadConversationUiVariant,
  loadLastAgent,
  loadParticipantId,
  loadSession,
  removeSession,
  replaceAllSessions,
  saveLastAgent,
  saveConversationUiVariant,
  saveParticipantId,
  saveSession
} from "./storage";
import type {
  ChatResponse,
  ChatScene,
  ConversationSession,
  ConversationTurn,
  ConversationUiVariant,
  LightCue,
  SessionData,
  VoiceActivationMode,
  VoiceState
} from "./types";
import { OpenAiLiveAdapter, type MentorVoiceResult, type VoiceSessionAdapter } from "./voice";

const workerUrl = import.meta.env.VITE_WORKER_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");

const VOICE_PHASE_CUES: Record<"listening" | "thinking", LightCue> = {
  listening: { preset: "calm-empathize", durationMs: 4000, intensity: "low" },
  thinking: { preset: "confused-reflect", durationMs: 5000, intensity: "gentle" }
};

const MENTOR_VISUALS: Record<
  AgentId,
  { image: string; number: string; accent: string; promise: string }
> = {
  pathfinder: {
    image: "/assets/mentor-pathfinder-silhouette.png",
    number: "01",
    accent: "#f1b84b",
    promise: "갈림길을 지나온 선배"
  },
  creator: {
    image: "/assets/mentor-creator-silhouette.png",
    number: "02",
    accent: "#cf7565",
    promise: "멈춤을 재료로 바꾸는 선배"
  },
  thinker: {
    image: "/assets/mentor-thinker-silhouette.png",
    number: "03",
    accent: "#4fa7a0",
    promise: "정답보다 기준을 묻는 선배"
  },
  connector: {
    image: "/assets/mentor-connector-silhouette.png",
    number: "04",
    accent: "#d39b35",
    promise: "두려움 속에서도 준비하며 나아가는 선배"
  }
};

export default function App() {
  const [accessReady, setAccessReady] = useState(() => hasLocalSessions());
  const [participantId, setParticipantId] = useState<string | null>(() => loadParticipantId());
  const [conversationUi, setConversationUi] = useState<ConversationUiVariant>(() =>
    loadConversationUiVariant()
  );
  const [sessionLookupLoading, setSessionLookupLoading] = useState(false);
  const [sessionLookupError, setSessionLookupError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<AgentId>(() => loadLastAgent() || "pathfinder");
  const [view, setView] = useState<"hub" | "conversation">(() =>
    loadSession(loadLastAgent() || "pathfinder") ? "conversation" : "hub"
  );
  const [session, setSession] = useState<ConversationSession>(() => getOrCreateSession(agentId));
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [hueEnabled, setHueEnabled] = useState(() => loadHueEffectsEnabled());
  const [hueState, setHueState] = useState<HueConnectionState>("disabled");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceMode, setVoiceMode] = useState<VoiceActivationMode>(loadVoiceMode);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceUserTranscript, setVoiceUserTranscript] = useState("");
  const [voiceAssistantTranscript, setVoiceAssistantTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceAdapterRef = useRef<VoiceSessionAdapter | null>(null);
  const voiceHueCommandRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const voiceHuePhaseRef = useRef<"listening" | "thinking" | "answer" | null>(null);
  const sessionRef = useRef(session);
  const hueEnabledRef = useRef(hueEnabled);
  const loadingRef = useRef(false);

  const agent = AGENTS[agentId];
  const savedSessions = Object.fromEntries(
    (Object.keys(AGENTS) as AgentId[]).map((id) => [id, Boolean(loadSession(id))])
  ) as Record<AgentId, boolean>;

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { hueEnabledRef.current = hueEnabled; }, [hueEnabled]);
  useEffect(() => () => {
    void voiceAdapterRef.current?.stop();
    void voiceHueCommandRef.current.finally(() => stopHueEffects());
  }, []);

  useEffect(() => {
    if (voiceMode !== "push_to_talk" || voiceState === "idle" || voiceState === "error") return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      voiceAdapterRef.current?.setPushToTalk(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      voiceAdapterRef.current?.setPushToTalk(false);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [voiceMode, voiceState]);

  useEffect(() => {
    if (accessReady && participantId && hasLocalSessions()) {
      void saveCloudSnapshot(participantId);
    }
  }, [accessReady, participantId]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    async function refreshHueStatus() {
      const nextState = await readHueStatus(hueEnabled);
      if (active) setHueState(nextState);
    }

    void refreshHueStatus();
    if (isHueCompanionHost() && hueEnabled) {
      timer = window.setInterval(() => void refreshHueStatus(), 10_000);
    }

    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [hueEnabled]);

  async function recoverSession(nextParticipantId: string) {
    const normalizedId = nextParticipantId.trim();
    setSessionLookupLoading(true);
    setSessionLookupError(null);

    try {
      const response = await fetch(`${workerUrl}/api/session/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: normalizedId })
      });
      const payload = (await response.json()) as {
        found?: boolean;
        sessionData?: SessionData;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message || "session_load_failed");

      saveParticipantId(normalizedId);
      setParticipantId(normalizedId);

      if (payload.found && payload.sessionData?.version === 1) {
        replaceAllSessions(payload.sessionData);
        const recoveredAgent = payload.sessionData.lastAgentId || findNewestAgent(payload.sessionData) || "pathfinder";
        const recoveredSession = payload.sessionData.sessions[recoveredAgent];
        setAgentId(recoveredAgent);
        setSession(recoveredSession || createSession(recoveredAgent));
        setView(recoveredSession ? "conversation" : "hub");
      } else {
        setView("hub");
      }
      setAccessReady(true);
    } catch {
      setSessionLookupError("기록을 불러오지 못했어요. ID와 네트워크를 확인해 주세요.");
    } finally {
      setSessionLookupLoading(false);
    }
  }

  function enterConversation(nextAgentId: AgentId) {
    if (!AGENTS[nextAgentId].active) return;
    void stopVoiceConversation();
    setAgentId(nextAgentId);
    saveLastAgent(nextAgentId);
    setSession(getOrCreateSession(nextAgentId));
    setErrorMessage(null);
    setRetryText(null);
    setView("conversation");
    if (participantId) void saveCloudSnapshot(participantId);
  }

  function changeConversationUi(variant: ConversationUiVariant) {
    setConversationUi(variant);
    saveConversationUiVariant(variant);
  }

  async function sendMessage(
    text: string,
    appendUser = true,
    inputMode: "text" | "voice" = "text",
    turnId?: string
  ): Promise<MentorVoiceResult | null> {
    const trimmed = text.trim();
    if (!trimmed || loadingRef.current) return null;

    const currentSession = sessionRef.current;
    const userTurn = makeTurn("user", trimmed, inputMode, turnId);
    const nextSession = appendUser
      ? updateSession(currentSession, [...currentSession.turns, userTurn])
      : currentSession;

    if (appendUser) {
      setSession(nextSession);
      sessionRef.current = nextSession;
      saveSession(nextSession);
      if (participantId) void saveCloudSnapshot(participantId);
    }
    setInput("");
    setIsLoading(true);
    loadingRef.current = true;
    setErrorMessage(null);
    setRetryText(null);

    try {
      const response = await fetch(`${workerUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          sessionId: nextSession.id,
          conversationId: nextSession.id,
          turnId: turnId || userTurn.id,
          inputMode,
          messages: nextSession.turns.map((turn) => ({
            role: turn.role,
            content: turn.role === "assistant" && turn.deliveryStatus === "interrupted" && turn.spokenText
              ? turn.spokenText
              : turn.content
          }))
        })
      });
      const payload = (await response.json()) as ChatResponse;

      if (!payload.scene || !payload.message) {
        throw new Error(payload.error || "invalid_response");
      }

      const assistantTurn: ConversationTurn = {
        id: createId(),
        role: "assistant",
        content: payload.message,
        createdAt: Date.now(),
        scene: payload.scene,
        groundingConfidence: payload.groundingConfidence,
        insufficientEvidence: payload.insufficientEvidence,
        citations: payload.citations || [],
        safetyStatus: payload.safety?.status || "allowed",
        inputMode
      };
      const completedSession = updateSession(nextSession, [...nextSession.turns, assistantTurn]);
      setSession(completedSession);
      sessionRef.current = completedSession;
      saveSession(completedSession);
      if (participantId) void saveCloudSnapshot(participantId);

      const lightCue = payload.scene.lightCue || deriveLightCue(
        payload.scene.text || payload.message,
        payload.scene.mood,
        payload.scene.emotionTag,
        payload.scene.intentTag
      );

      if (inputMode === "text") {
        void playAssistantOutput(
          agentId,
          payload.id || assistantTurn.id,
          lightCue,
          hueEnabled
        ).then(async (played) => {
          if (!isHueCompanionHost() || !hueEnabled) return;
          if (!played) setHueState(await readHueStatus(hueEnabled));
          else setHueState("connected");
        });
      }

      if (!response.ok) {
        setErrorMessage("연결이 완전히 회복되지는 않았어요.");
        setRetryText(trimmed);
      }
      return { message: payload.message, responseId: payload.id || assistantTurn.id, lightCue };
    } catch {
      setErrorMessage("대화를 이어오는 중 연결이 끊겼어요.");
      setRetryText(trimmed);
      return null;
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }

  async function startVoiceConversation() {
    if (voiceAdapterRef.current) return;
    setVoiceError(null);
    setVoiceMuted(false);
    const adapter = new OpenAiLiveAdapter(workerUrl, agentId, sessionRef.current.id, voiceMode, {
      onAudioLevel: createVoiceHueMeter(agentId, () => hueEnabledRef.current && voiceAdapterRef.current !== null),
      onState: (state) => {
        setVoiceState(state);
        if (state === "user-speaking") void playVoiceHuePhase("listening");
        else if (state === "thinking") void playVoiceHuePhase("thinking");
        else if (state === "listening" && voiceHuePhaseRef.current === null) {
          void playVoiceHuePhase("listening");
        }
        else if (state === 'idle' || state === 'error') {
          voiceHuePhaseRef.current = null;
          void voiceHueCommandRef.current.catch(() => false).then(() => stopHueEffects());
        }
      },
      onTranscript: (speaker, text) => {
        if (speaker === "user") setVoiceUserTranscript(text);
        else setVoiceAssistantTranscript(text);
      },
      onDelegation: (text, id) => sendMessage(text, true, "voice", id),
      onPlaybackStart: (result) => {
        if (!result.lightCue) return;
        voiceHuePhaseRef.current = "answer";
        void queueVoiceHueCue(result.responseId, result.lightCue);
      },
      onPlaybackEnd: (_result, spokenText) => {
        if (spokenText) markLatestVoiceDelivery("completed", spokenText);
        void playVoiceHuePhase('listening');
      },
      onInterrupted: (_result, spokenText) => {
        markLatestVoiceDelivery("interrupted", spokenText);
        void playVoiceHuePhase('listening');
      },
      onError: setVoiceError
    });
    voiceAdapterRef.current = adapter;
    try {
      await adapter.start();
    } catch (error) {
      voiceAdapterRef.current = null;
      setVoiceState("error");
      setVoiceError(error instanceof Error ? error.message : "음성 대화를 시작하지 못했어요.");
    }
  }

  async function stopVoiceConversation() {
    const adapter = voiceAdapterRef.current;
    voiceAdapterRef.current = null;
    if (adapter) await adapter.stop();
    setVoiceState("idle");
    setVoiceMuted(false);
    setVoiceUserTranscript("");
    setVoiceAssistantTranscript("");
    await voiceHueCommandRef.current.catch(() => false);
    voiceHuePhaseRef.current = null;
    if (isHueCompanionHost()) await stopHueEffects();
  }

  async function playVoiceHuePhase(phase: "listening" | "thinking") {
    if (voiceHuePhaseRef.current === phase) return;
    voiceHuePhaseRef.current = phase;
    await queueVoiceHueCue(
      `${sessionRef.current.id}-${phase}-${Date.now()}`,
      VOICE_PHASE_CUES[phase], phase
    );
  }

  function queueVoiceHueCue(responseId: string, cue: LightCue, phase: 'listening' | 'thinking' | 'answer' = 'answer'): Promise<boolean> {
    const request = voiceHueCommandRef.current
      .catch(() => false)
      .then(() => playAssistantOutput(agentId, responseId, cue, hueEnabledRef.current, "voice", phase));
    voiceHueCommandRef.current = request.catch(() => false);
    void request.then(async (played) => {
      if (!isHueCompanionHost() || !hueEnabledRef.current) return;
      if (!played) setHueState(await readHueStatus(hueEnabledRef.current));
      else setHueState("connected");
    });
    return request;
  }

  function markLatestVoiceDelivery(status: "completed" | "interrupted", spokenText: string) {
    const current = sessionRef.current;
    const index = [...current.turns].map((turn) => turn.role).lastIndexOf("assistant");
    if (index < 0) return;
    const turns = current.turns.map((turn, turnIndex) => turnIndex === index
      ? { ...turn, deliveryStatus: status, spokenText }
      : turn
    );
    const updated = updateSession(current, turns);
    sessionRef.current = updated;
    setSession(updated);
    saveSession(updated);
    if (participantId) void saveCloudSnapshot(participantId);
  }

  function resetConversation() {
    const confirmed = window.confirm("이 선배와의 대화 기록을 지우고 새로 시작할까요?");
    if (!confirmed) return;
    void stopVoiceConversation();
    removeSession(agentId);
    const nextSession = createSession(agentId);
    setSession(nextSession);
    sessionRef.current = nextSession;
    saveSession(nextSession);
    if (participantId) void saveCloudSnapshot(participantId);
    setInput("");
    setErrorMessage(null);
    setRetryText(null);
  }

  function toggleHueEffects(enabled: boolean) {
    setHueEnabled(enabled);
    hueEnabledRef.current = enabled;
    saveHueEffectsEnabled(enabled);
    if (!enabled) {
      setHueState("disabled");
      voiceHuePhaseRef.current = null;
      void voiceHueCommandRef.current.finally(() => stopHueEffects());
    }
  }

  const hueControl = isHueCompanionHost() ? (
    <HueControl enabled={hueEnabled} state={hueState} onToggle={toggleHueEffects} />
  ) : null;

  const voiceControl = (
    <VoiceControl
      state={voiceState}
      activationMode={voiceMode}
      muted={voiceMuted}
      userTranscript={voiceUserTranscript}
      assistantTranscript={voiceAssistantTranscript}
      error={voiceError}
      onActivationModeChange={(mode) => {
        setVoiceMode(mode);
        saveVoiceMode(mode);
      }}
      onStart={() => void startVoiceConversation()}
      onStop={() => void stopVoiceConversation()}
      onToggleMute={() => {
        const next = !voiceMuted;
        setVoiceMuted(next);
        voiceAdapterRef.current?.setMuted(next);
      }}
      onPushToTalk={(active) => voiceAdapterRef.current?.setPushToTalk(active)}
    />
  );

  if (!accessReady) {
    return (
      <SessionGate
        isLoading={sessionLookupLoading}
        errorMessage={sessionLookupError}
        onContinue={(id) => void recoverSession(id)}
      />
    );
  }

  if (view === "hub") {
    return (
      <>
        <MentorHub
          visuals={MENTOR_VISUALS}
          savedSessions={savedSessions}
          conversationUi={conversationUi}
          onConversationUiChange={changeConversationUi}
          onSelect={enterConversation}
        />
        {hueControl}
      </>
    );
  }

  if (conversationUi === "B") {
    return (
      <>
        <ConversationStageB
          agent={agent}
          portrait={MENTOR_VISUALS[agentId].image}
          session={session}
          input={input}
          isLoading={isLoading}
          errorMessage={errorMessage}
          retryText={retryText}
          onInputChange={setInput}
          onSend={(text) => void sendMessage(text)}
          onRetry={() => retryText && void sendMessage(retryText, false)}
          onReset={resetConversation}
          onBack={() => { void stopVoiceConversation(); setView("hub"); }}
          voiceControl={voiceControl}
        />
        {hueControl}
      </>
    );
  }

  return (
    <>
      <ConversationStage
        agent={agent}
        portrait={MENTOR_VISUALS[agentId].image}
        session={session}
        input={input}
        isLoading={isLoading}
        errorMessage={errorMessage}
        retryText={retryText}
        onInputChange={setInput}
        onSend={(text) => void sendMessage(text)}
        onRetry={() => retryText && void sendMessage(retryText, false)}
        onReset={resetConversation}
        onBack={() => { void stopVoiceConversation(); setView("hub"); }}
        voiceControl={voiceControl}
      />
      {hueControl}
    </>
  );
}

async function saveCloudSnapshot(participantId: string): Promise<void> {
  try {
    await fetch(`${workerUrl}/api/session/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, sessionData: loadAllSessions() })
    });
  } catch {
    // Local storage is the primary record; cloud sync retries on the next change or visit.
  }
}

function findNewestAgent(data: SessionData): AgentId | null {
  const sessions = Object.values(data.sessions).filter(
    (session): session is ConversationSession => Boolean(session)
  );
  sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  return sessions[0]?.agentId || null;
}

function getOrCreateSession(agentId: AgentId): ConversationSession {
  return loadSession(agentId) || createSession(agentId);
}

function createSession(agentId: AgentId): ConversationSession {
  const agent = AGENTS[agentId];
  const openingScene: ChatScene = {
    speaker: agent.title,
    text: agent.openingPrompt,
    mood: "neutral",
    portraitVariant: "neutral",
    choices: agent.openingChoices.map((label, index) => ({
      id: `opening-${index + 1}`,
      label
    }))
  };
  const now = Date.now();
  return {
    id: createId(),
    agentId,
    createdAt: now,
    updatedAt: now,
    turns: [
      {
        id: createId(),
        role: "assistant",
        content: agent.openingPrompt,
        createdAt: now,
        scene: openingScene,
        citations: [],
        safetyStatus: "allowed"
      }
    ]
  };
}

function makeTurn(
  role: "user" | "assistant",
  content: string,
  inputMode: "text" | "voice" = "text",
  id = createId()
): ConversationTurn {
  return {
    id,
    role,
    content,
    createdAt: Date.now(),
    inputMode
  };
}

function updateSession(
  session: ConversationSession,
  turns: ConversationTurn[]
): ConversationSession {
  return {
    ...session,
    turns,
    updatedAt: Date.now()
  };
}

function loadVoiceMode(): VoiceActivationMode {
  try {
    const value = localStorage.getItem("nextgenagent:voice-mode:v1");
    return value === "wake_prefix" || value === "push_to_talk" ? value : "tap_vad";
  } catch { return "tap_vad"; }
}

function saveVoiceMode(mode: VoiceActivationMode): void {
  try { localStorage.setItem("nextgenagent:voice-mode:v1", mode); } catch { /* optional preference */ }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
