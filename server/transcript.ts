import { open, stat } from "node:fs/promises";
import type { ActionEntry, ToolCall } from "../shared/types.ts";

const MAX_RECENT = 40;
/** On first read, only this much of the end of a transcript is replayed. */
const INITIAL_TAIL_BYTES = 1_500_000;

/** State folded from a transcript, shared by main sessions and subagents. */
export interface TranscriptState {
  pending: Map<string, ToolCall>;
  lastTool: { call: ToolCall; endedAt: number } | null;
  lastStopReason: string | null;
  turnActive: boolean;
  lastRecordAt: number;
  firstRecordAt: number;
  contextTokens: number;
  model: string | null;
  branch: string | null;
  title: string | null;
  lastPrompt: string | null;
  permissionMode: string | null;
  lastError: number | null;
  recent: ActionEntry[];
}

export function emptyState(): TranscriptState {
  return {
    pending: new Map(),
    lastTool: null,
    lastStopReason: null,
    turnActive: false,
    lastRecordAt: 0,
    firstRecordAt: 0,
    contextTokens: 0,
    model: null,
    branch: null,
    title: null,
    lastPrompt: null,
    permissionMode: null,
    lastError: null,
    recent: [],
  };
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
};

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

export function summarizeTool(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Bash":
      return clip(str("description") || str("command"), 90);
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return basename(str("file_path") || str("notebook_path"));
    case "Grep":
    case "Glob":
      return clip(str("pattern"), 60);
    case "WebSearch":
      return clip(str("query"), 80);
    case "WebFetch":
      try {
        return new URL(str("url")).hostname;
      } catch {
        return clip(str("url"), 60);
      }
    case "Agent":
    case "Task":
      return clip(str("description") || str("prompt"), 80);
    case "Skill":
      return str("skill");
    case "AskUserQuestion":
      return "asking you a question";
    case "ExitPlanMode":
      return "plan ready for review";
    default:
      return clip(str("description") || str("query") || str("prompt") || "", 80);
  }
}

/** Short display name, so mcp__blender__get_scene_info reads as blender: get_scene_info. */
export function toolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1]}: ${m[2]}` : name;
}

function push(state: TranscriptState, entry: ActionEntry) {
  state.recent.push(entry);
  if (state.recent.length > MAX_RECENT) state.recent.shift();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join(" ");
}

/** Prompts injected by the harness rather than typed by a person. */
const isSyntheticPrompt = (text: string) =>
  /^<(command-name|local-command|task-notification|system-reminder|bash-(input|stdout))/.test(text.trim()) ||
  text.startsWith("Caveat:") ||
  text.startsWith("[Request interrupted");

export function applyRecord(state: TranscriptState, rec: any, opts: { sidechain: boolean }) {
  if (!rec || typeof rec !== "object") return;
  if (!!rec.isSidechain !== opts.sidechain) return;

  const at = rec.timestamp ? Date.parse(rec.timestamp) : 0;
  if (at) {
    state.lastRecordAt = Math.max(state.lastRecordAt, at);
    if (!state.firstRecordAt) state.firstRecordAt = at;
  }
  if (typeof rec.gitBranch === "string" && rec.gitBranch) state.branch = rec.gitBranch;

  switch (rec.type) {
    case "ai-title":
      if (typeof rec.aiTitle === "string") state.title = rec.aiTitle;
      return;
    case "permission-mode":
      if (typeof rec.permissionMode === "string") state.permissionMode = rec.permissionMode;
      return;
    case "system":
      if (rec.subtype === "turn_duration") {
        state.turnActive = false;
        state.pending.clear();
      } else if (rec.subtype === "compact_boundary") {
        const post = rec.compactMetadata?.postTokens;
        if (typeof post === "number") state.contextTokens = post;
      }
      return;
    case "assistant": {
      const msg = rec.message ?? {};
      if (typeof msg.model === "string" && !msg.model.startsWith("<")) state.model = msg.model;
      const u = msg.usage;
      if (u) {
        state.contextTokens =
          (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      }
      state.lastStopReason = msg.stop_reason ?? null;
      state.turnActive = msg.stop_reason !== "end_turn";
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type === "tool_use") {
          const call: ToolCall = {
            id: block.id,
            name: block.name,
            summary: summarizeTool(block.name, block.input ?? {}),
            startedAt: at || Date.now(),
          };
          state.pending.set(call.id, call);
          push(state, { at: call.startedAt, kind: "tool", label: toolLabel(call.name), detail: call.summary });
        } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
          push(state, { at, kind: "text", label: "says", detail: clip(block.text, 160) });
        }
      }
      return;
    }
    case "user": {
      const content = rec.message?.content;
      let sawResult = false;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== "tool_result") continue;
          sawResult = true;
          const call = state.pending.get(block.tool_use_id);
          if (call) {
            state.pending.delete(block.tool_use_id);
            state.lastTool = { call, endedAt: at || Date.now() };
          }
          if (block.is_error) {
            state.lastError = at;
            push(state, {
              at,
              kind: "error",
              label: call ? toolLabel(call.name) : "tool",
              detail: clip(textOf(block.content) || String(block.content ?? ""), 140),
            });
          }
        }
      }
      if (sawResult) {
        state.turnActive = true;
        return;
      }
      const text = textOf(content);
      if (!text || rec.isMeta || isSyntheticPrompt(text)) return;
      state.pending.clear();
      state.turnActive = true;
      state.lastPrompt = clip(text, 400);
      push(state, { at, kind: "prompt", label: "you", detail: clip(text, 160) });
      return;
    }
  }
}

/** Follows one JSONL transcript, folding each new line into a TranscriptState. */
export class TranscriptTail {
  readonly state = emptyState();
  private offset = -1;
  private carry = "";
  private busy = false;

  constructor(
    readonly path: string,
    private readonly sidechain: boolean,
  ) {}

  /** Reads anything appended since the last call. Returns true if state changed. */
  async poll(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const { size } = await stat(this.path);
      if (this.offset < 0) {
        this.offset = Math.max(0, size - INITIAL_TAIL_BYTES);
        // Starting mid-file lands inside a line, which the first split discards.
        this.carry = this.offset > 0 ? "\u0000" : "";
      }
      if (size < this.offset) {
        this.offset = 0;
        this.carry = "";
      }
      if (size === this.offset) return false;

      const fh = await open(this.path, "r");
      try {
        const buf = Buffer.alloc(size - this.offset);
        await fh.read(buf, 0, buf.length, this.offset);
        this.offset = size;
        const lines = (this.carry + buf.toString("utf8")).split("\n");
        this.carry = lines.pop() ?? "";
        for (const line of lines) {
          if (!line || line.charCodeAt(0) === 0) continue;
          try {
            applyRecord(this.state, JSON.parse(line), { sidechain: this.sidechain });
          } catch {
            // A torn or non-JSON line is skipped; the next poll continues after it.
          }
        }
      } finally {
        await fh.close();
      }
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }
}
