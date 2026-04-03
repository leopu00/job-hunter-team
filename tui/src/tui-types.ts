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
  lastCtrlCAt: number;
  isConnected: boolean;
};
