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

/** The agent's terminal in Orca, present when Orca launched the session. */
export interface OrcaLink {
  /** False when Orca reports the terminal as disconnected or not accepting input. */
  writable: boolean;
  worktreeName: string | null;
  /** Orca's card status for the worktree, such as in-progress or in-review. */
  status: string | null;
  comment: string | null;
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
  /** The app whose terminal hosts the session, such as Orca or Cursor. */
  app: string | null;
  orca: OrcaLink | null;
}

export interface OfficeSnapshot {
  at: number;
  hooksInstalled: boolean;
  /** False when the server was started read-only and will not send anything to agents. */
  canSend: boolean;
  agents: AgentSnapshot[];
}

export interface TerminalView {
  lines: string[];
}

export interface SendResult {
  /** True once the agent's turn was seen to start; false means the message is queued. */
  started: boolean;
}

export type ServerMessage = { type: "snapshot"; data: OfficeSnapshot };

export const DEFAULT_PORT = 4821;
