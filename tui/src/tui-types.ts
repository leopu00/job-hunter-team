export type AgentRole =
  | "alfa"
  | "analista"
  | "assistente"
  | "critico"
  | "scorer"
  | "scout"
  | "scrittore"
  | "sentinella"
  | string;

export type AgentStatus = "idle" | "working" | "error" | "offline";

export type JhtAgent = {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  sessionKey?: string;
  totalTokens?: number | null;
  contextTokens?: number | null;
  model?: string;
  lastActivity?: number | null;
  errorMessage?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agentId: string;
  timestamp: number;
  tokens?: number;
};

export type TuiOptions = {
  url?: string;
  token?: string;
  password?: string;
  logFile?: string;
};

export type JhtTuiState = {
  agents: JhtAgent[];
  selectedAgentId: string | null;
  messages: ChatMessage[];
  connectionStatus: string;
  activityStatus: string;
  toolsExpanded: boolean;
  isConnected: boolean;
  /** Numero di sessioni JHT-* attive lette da tmux list-sessions */
  activeTmuxCount: number;
};

// --- Tipi per il layer chat/event (tui-event-handlers, tui-command-handlers) ---

export type ChatOptions = {
  session?: string;
  deliver?: boolean;
  thinking?: string;
  timeoutMs?: number;
  historyLimit?: number;
  message?: string;
};

export type SessionInfo = {
  model?: string;
  modelProvider?: string;
  verboseLevel?: string;
  contextTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type ChatEvent = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

export type AgentEvent = {
  runId: string;
  stream: string;
  data?: Record<string, unknown>;
};

export type BtwEvent = {
  kind: "btw";
  runId?: string;
  sessionKey?: string;
  question: string;
  text: string;
  isError?: boolean;
};

export type TuiStateAccess = JhtTuiState & {
  currentAgentId: string;
  currentSessionKey: string;
  activeChatRunId: string | null;
  pendingOptimisticUserMessage: boolean;
  historyLoaded: boolean;
  sessionInfo: SessionInfo;
  showThinking: boolean;
};
