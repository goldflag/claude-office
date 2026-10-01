// Wire types shared by the Bun server and the browser client.

/** What the agent is doing right now, coarse enough to animate. */
export type Activity =
  | "thinking"
  | "writing"
  | "terminal"
  | "reading"
  | "web"
  | "delegating"
  | "tool"
  | "waiting"
  | "done"
  | "idle"
  | "sleeping"
  /** Idle so long that the agent has left the office. */
  | "away";

export type NeedsYouReason = "permission" | "question" | "plan";

export interface NeedsYou {
  reason: NeedsYouReason;
  message: string;
  since: number;
  /** true when reported by a hook, false when inferred from files. */
  exact: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Short human-readable target: a file name, a command, a query. */
  summary: string;
  startedAt: number;
}

export interface ActionEntry {
  at: number;
  kind: "prompt" | "tool" | "text" | "error";
  label: string;
  detail: string;
}

export interface SubagentSnapshot {
  id: string;
  type: string;
  description: string;
  activity: Activity;
  currentTool: ToolCall | null;
  startedAt: number;
  updatedAt: number;
}

export interface AgentSnapshot {
  /** Stable per process, so a desk survives /clear and resume. */
  id: string;
  pid: number;
  sessionId: string;
  name: string;
  title: string | null;
  cwd: string;
  project: string;
  worktree: string | null;
  branch: string | null;
  model: string | null;
  status: string;
  activity: Activity;
  needsYou: NeedsYou | null;
  currentTool: ToolCall | null;
  lastPrompt: string | null;
  lastError: number | null;
  contextTokens: number;
  startedAt: number;
  /** Last time anything was written to the transcript. */
  lastActivityAt: number;
  /** When the agent last stopped working, used for idle and sleep timing. */
  idleSince: number | null;
  recent: ActionEntry[];
  subagents: SubagentSnapshot[];
}

export interface OfficeSnapshot {
  at: number;
  hooksInstalled: boolean;
  agents: AgentSnapshot[];
}

export type ServerMessage = { type: "snapshot"; data: OfficeSnapshot };

export const DEFAULT_PORT = 4821;
