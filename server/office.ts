import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  Activity,
  AgentSnapshot,
  NeedsYou,
  OfficeSnapshot,
  OrcaLink,
  ScrollbackView,
  SendResult,
  SubagentSnapshot,
  TerminalView,
  ToolCall,
} from "../shared/types.ts";
import { inspectProcess, Orca, OrcaError, type ProcessHost } from "./orca.ts";
import { readScrollback, TranscriptTail, type TranscriptState } from "./transcript.ts";
import { Usage } from "./usage.ts";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
/** Set OFFICE_READ_ONLY=1 to run the office as a pure viewer. */
const READ_ONLY = process.env.OFFICE_READ_ONLY === "1";
const MAX_MESSAGE_LENGTH = 4000;
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

/** How long a finished tool keeps driving the animation, so fast tools are visible. */
const TOOL_LINGER_MS = 3500;
const DONE_MS = 3 * 60_000;
const SLEEP_MS = 30 * 60_000;
const AWAY_MS = 2 * 3600_000;
const SUBAGENT_STALE_MS = 5 * 60_000;
/** Tag carried by every hook command this project installs into settings.json. */
export const HOOK_MARKER = "claude-office-hook";
/** After a hook event, file-based permission guessing is switched off for the session. */
const HOOK_TRUST_MS = 6 * 3600_000;

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  name?: string;
  status?: string;
  statusUpdatedAt?: number;
  updatedAt?: number;
}

interface GitInfo {
  project: string;
  worktree: string | null;
}

interface Subagent {
  id: string;
  tail: TranscriptTail;
  type: string;
  description: string;
  mtime: number;
}

interface Agent {
  file: SessionFile;
  git: GitInfo;
  host: ProcessHost;
  tail: TranscriptTail | null;
  tailSessionId: string | null;
  subagents: Map<string, Subagent>;
  hookNeedsYou: NeedsYou | null;
  /** Tool named by the last permission request hook. */
  hookTool: string | null;
  lastHookAt: number;
}

export function toolActivity(name: string): Activity {
  if (name === "Edit" || name === "Write" || name === "NotebookEdit") return "writing";
  if (name === "Bash" || name === "BashOutput" || name === "KillShell" || name === "Monitor") return "terminal";
  if (name === "Read" || name === "Grep" || name === "Glob" || name === "ToolSearch") return "reading";
  if (name === "WebSearch" || name === "WebFetch" || name.includes("chrome") || name.includes("browser")) return "web";
  if (name === "Agent" || name === "Task" || name === "Workflow" || name === "SendMessage") return "delegating";
  return "tool";
}

const INSTANT_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit", "Glob", "Grep"]);
const NEVER_BLOCKED = new Set(["Agent", "Task", "Workflow", "SendMessage", "Monitor", "ScheduleWakeup"]);

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
};

const gitCache = new Map<string, Promise<GitInfo>>();

function gitInfo(cwd: string): Promise<GitInfo> {
  let cached = gitCache.get(cwd);
  if (!cached) {
    cached = (async () => {
      const fallback = { project: basename(cwd) || cwd, worktree: null };
      try {
        const proc = Bun.spawn(
          ["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"],
          { stdout: "pipe", stderr: "ignore" },
        );
        const [commonDir, toplevel] = (await new Response(proc.stdout).text()).trim().split("\n");
        if ((await proc.exited) !== 0 || !commonDir || !toplevel) return fallback;
        const mainRoot = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
        return {
          project: basename(mainRoot),
          worktree: toplevel === mainRoot ? null : basename(toplevel),
        };
      } catch {
        return fallback;
      }
    })();
    gitCache.set(cwd, cached);
  }
  return cached;
}

async function findTranscript(file: SessionFile): Promise<string | null> {
  const direct = join(PROJECTS_DIR, file.cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${file.sessionId}.jsonl`);
  if (await Bun.file(direct).exists()) return direct;
  for await (const hit of new Bun.Glob(`*/${file.sessionId}.jsonl`).scan({ cwd: PROJECTS_DIR })) {
    return join(PROJECTS_DIR, hit);
  }
  return null;
}

/** Seconds from a ps etime field, formatted as [[dd-]hh:]mm:ss. */
function etimeSeconds(etime: string): number {
  const [days, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = (rest ?? "").split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(days) * 86400 + (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

/** Youngest shell child per parent pid, in seconds. A running Bash tool always has one. */
async function youngestShellChild(): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  try {
    const proc = Bun.spawn(["ps", "-axo", "pid=,ppid=,etime=,comm="], { stdout: "pipe", stderr: "ignore" });
    for (const line of (await new Response(proc.stdout).text()).split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m || !/(^|\/)(zsh|bash|sh|fish|dash)$/.test(m[4]!.trim())) continue;
      const ppid = Number(m[2]);
      const age = etimeSeconds(m[3]!);
      if (!out.has(ppid) || age < out.get(ppid)!) out.set(ppid, age);
    }
  } catch {
    // Without ps, Bash prompts are simply not inferred.
  }
  return out;
}

/**
 * Guesses a blocking prompt from the transcript alone.
 *
 * Only the oldest pending call is judged. Calls sent in one batch run in
 * order, so the later ones are merely queued, however long they wait.
 */
export function inferNeedsYou(
  state: TranscriptState,
  now: number,
  opts: { hooksReporting: boolean; youngestShell: number | undefined },
): NeedsYou | null {
  const call = state.pending.values().next().value;
  if (!call) return null;
  if (call.name === "AskUserQuestion") {
    return { reason: "question", message: "Asked you a question", since: call.startedAt, exact: true };
  }
  if (call.name === "ExitPlanMode") {
    return { reason: "plan", message: "Plan is ready for your review", since: call.startedAt, exact: true };
  }
  // With hooks installed, permission prompts are reported exactly instead.
  if (opts.hooksReporting || state.permissionMode === "bypassPermissions" || NEVER_BLOCKED.has(call.name)) return null;

  const age = now - call.startedAt;
  let blocked: boolean;
  if (INSTANT_TOOLS.has(call.name)) blocked = age > 3000;
  else if (call.name === "Bash") {
    // A running Bash call always has a shell process at least as young as the call.
    blocked = age > 4000 && (opts.youngestShell === undefined || opts.youngestShell > age / 1000 + 3);
  } else blocked = age > 45_000;

  return blocked
    ? {
        reason: "permission",
        message: `Probably waiting for permission: ${call.name} ${call.summary}`.trim(),
        since: call.startedAt,
        exact: false,
      }
    : null;
}

export class Office {
  private agents = new Map<number, Agent>();
  private shellChildren = new Map<number, number>();
  private hooksInstalled = false;
  private lastJson = "";
  private listeners = new Set<(snap: OfficeSnapshot) => void>();
  private tick = 0;
  private orca = new Orca();
  private usage = new Usage();
  current: OfficeSnapshot = {
    at: Date.now(),
    hooksInstalled: false,
    canSend: !READ_ONLY,
    agents: [],
    usage: { tokens: null, limits: null },
  };

  start() {
    this.usage.start();
    const loop = async () => {
      try {
        await this.refresh();
      } catch (err) {
        console.error("[office] refresh failed", err);
      }
      setTimeout(loop, 400);
    };
    void loop();
  }

  subscribe(fn: (snap: OfficeSnapshot) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ingests one Claude Code hook payload. Unknown sessions are ignored. */
  onHook(payload: any) {
    const agent = [...this.agents.values()].find((a) => a.file.sessionId === payload?.session_id);
    if (!agent) return;
    agent.lastHookAt = Date.now();
    const event = payload.hook_event_name;
    const since = Date.now();
    if (event === "PermissionRequest") {
      const tool = String(payload.tool_name ?? "a tool");
      agent.hookNeedsYou = { reason: "permission", message: `Wants permission to use ${tool}`, since, exact: true };
      agent.hookTool = tool;
    } else if (event === "Notification") {
      const message = String(payload.message ?? "");
      const kind = String(payload.notification_type ?? "");
      if (kind === "permission_prompt" || /permission|approv/i.test(message)) {
        agent.hookNeedsYou ??= { reason: "permission", message, since, exact: true };
      } else if (kind === "elicitation_dialog") {
        agent.hookNeedsYou = { reason: "question", message, since, exact: true };
      }
    } else {
      // Any later lifecycle event means the prompt was answered one way or another.
      agent.hookNeedsYou = null;
    }
  }

  /**
   * No hook fires when a prompt is approved, so an approved long-running tool
   * would look blocked until it finished. These signals show it moved on.
   */
  private promptAnswered(agent: Agent, state: TranscriptState, now: number): boolean {
    const prompt = agent.hookNeedsYou;
    if (!prompt) return false;
    if (state.lastRecordAt > prompt.since + 300) return true;
    if (agent.hookTool === "Bash") {
      const youngest = this.shellChildren.get(agent.file.pid);
      return youngest !== undefined && youngest < (now - prompt.since) / 1000 + 1;
    }
    return false;
  }

  private async refresh() {
    this.tick++;
    if (this.tick % 25 === 1) {
      const settings = await readFile(join(CLAUDE_DIR, "settings.json"), "utf8").catch(() => "");
      this.hooksInstalled = settings.includes(HOOK_MARKER);
    }
    const names = (await readdir(SESSIONS_DIR).catch(() => [] as string[])).filter((n) => /^\d+\.json$/.test(n));
    const seen = new Set<number>();

    await Promise.all(
      names.map(async (name) => {
        let file: SessionFile;
        try {
          file = JSON.parse(await readFile(join(SESSIONS_DIR, name), "utf8"));
        } catch {
          return;
        }
        if (!file?.pid || !file.sessionId || !isAlive(file.pid)) return;
        seen.add(file.pid);

        let agent = this.agents.get(file.pid);
        if (!agent) {
          agent = {
            file,
            git: await gitInfo(file.cwd),
            host: await inspectProcess(file.pid),
            tail: null,
            tailSessionId: null,
            subagents: new Map(),
            hookNeedsYou: null,
            hookTool: null,
            lastHookAt: 0,
          };
          this.agents.set(file.pid, agent);
        } else {
          if (agent.file.cwd !== file.cwd) agent.git = await gitInfo(file.cwd);
          agent.file = file;
        }

        // /clear and resume swap the session id under the same pid.
        if (agent.tailSessionId !== file.sessionId || !agent.tail) {
          const path = await findTranscript(file);
          agent.tail = path ? new TranscriptTail(path, false) : null;
          agent.tailSessionId = path ? file.sessionId : null;
          agent.subagents.clear();
          agent.hookNeedsYou = null;
        }
        await agent.tail?.poll();
        if (this.tick % 4 === 1) await this.scanSubagents(agent);
        await Promise.all([...agent.subagents.values()].map((s) => s.tail.poll()));
      }),
    );

    for (const pid of this.agents.keys()) if (!seen.has(pid)) this.agents.delete(pid);
    if ([...this.agents.values()].some((a) => a.host.handle)) await this.orca.refresh(Date.now());

    const now = Date.now();
    const needsPs = [...this.agents.values()].some(
      (a) =>
        a.hookNeedsYou !== null ||
        [...(a.tail?.state.pending.values() ?? [])].some((c) => c.name === "Bash" && now - c.startedAt > 3000),
    );
    this.shellChildren = needsPs ? await youngestShellChild() : new Map();

    const agents = [...this.agents.values()]
      .map((a) => this.snapshotAgent(a, now))
      .sort((a, b) => a.startedAt - b.startedAt);
    const usage = this.usage.current;
    const json = JSON.stringify([this.hooksInstalled, agents, usage]);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.current = { at: now, hooksInstalled: this.hooksInstalled, canSend: !READ_ONLY, agents, usage };
    for (const fn of this.listeners) fn(this.current);
  }

  private async scanSubagents(agent: Agent) {
    if (!agent.tail) return;
    const dir = join(agent.tail.path.replace(/\.jsonl$/, ""), "subagents");
    const names = await readdir(dir).catch(() => [] as string[]);
    const now = Date.now();
    for (const name of names) {
      const m = /^agent-(.+)\.jsonl$/.exec(name);
      if (!m) continue;
      const id = m[1]!;
      const path = join(dir, name);
      const mtime = (await stat(path).catch(() => null))?.mtimeMs ?? 0;
      const existing = agent.subagents.get(id);
      if (existing) {
        existing.mtime = mtime;
        continue;
      }
      if (now - mtime > SUBAGENT_STALE_MS) continue;
      let meta: any = {};
      try {
        meta = JSON.parse(await readFile(join(dir, `agent-${id}.meta.json`), "utf8"));
      } catch {
        // Meta is optional; the subagent still shows with generic labels.
      }
      agent.subagents.set(id, {
        id,
        tail: new TranscriptTail(path, true),
        type: String(meta.agentType ?? "agent"),
        description: String(meta.description ?? ""),
        mtime,
      });
    }
    for (const [id, sub] of agent.subagents) {
      if (now - sub.mtime > SUBAGENT_STALE_MS) agent.subagents.delete(id);
    }
  }

  private workingActivity(state: TranscriptState, now: number): { activity: Activity; tool: ToolCall | null } {
    // Calls sent together run in order, so the oldest pending one is the one executing.
    const pending = state.pending.values().next().value;
    if (pending) return { activity: toolActivity(pending.name), tool: pending };
    if (state.lastTool && now - state.lastTool.endedAt < TOOL_LINGER_MS) {
      return { activity: toolActivity(state.lastTool.call.name), tool: state.lastTool.call };
    }
    return { activity: "thinking", tool: null };
  }

  private snapshotAgent(agent: Agent, now: number): AgentSnapshot {
    const { file, git, tail } = agent;
    const state = tail?.state ?? null;
    const status = file.status ?? "idle";
    const busy = status !== "idle" && status !== "shell";

    let activity: Activity = "idle";
    let currentTool: ToolCall | null = null;
    let needsYou: NeedsYou | null = null;
    let idleSince: number | null = null;

    const subagents: SubagentSnapshot[] = [];
    for (const sub of agent.subagents.values()) {
      const s = sub.tail.state;
      const finished = s.lastStopReason === "end_turn" && s.pending.size === 0;
      if (finished || now - sub.mtime > SUBAGENT_STALE_MS) continue;
      const w = this.workingActivity(s, now);
      subagents.push({
        id: sub.id,
        type: sub.type,
        description: sub.description,
        activity: w.activity,
        currentTool: w.tool,
        startedAt: s.firstRecordAt || sub.mtime,
        updatedAt: Math.max(s.lastRecordAt, sub.mtime),
      });
    }
    subagents.sort((a, b) => a.startedAt - b.startedAt);

    if (busy) {
      if (state) {
        if (this.promptAnswered(agent, state, now)) agent.hookNeedsYou = null;
        needsYou =
          agent.hookNeedsYou ??
          inferNeedsYou(state, now, {
            hooksReporting: now - agent.lastHookAt < HOOK_TRUST_MS,
            youngestShell: this.shellChildren.get(agent.file.pid),
          });
        const w = this.workingActivity(state, now);
        activity = w.activity;
        currentTool = w.tool;
        // A parent with live subagents and nothing else going on is supervising them.
        if (activity === "thinking" && subagents.length > 0 && now - state.lastRecordAt > 20_000) {
          activity = "delegating";
        }
      } else activity = "thinking";
      if (needsYou) activity = "waiting";
    } else {
      agent.hookNeedsYou = null;
      idleSince = Math.max(file.statusUpdatedAt ?? 0, state?.lastRecordAt ?? 0) || file.startedAt;
      const idleFor = now - idleSince;
      activity = idleFor < DONE_MS ? "done" : idleFor < SLEEP_MS ? "idle" : idleFor < AWAY_MS ? "sleeping" : "away";
    }

    return {
      id: String(file.pid),
      pid: file.pid,
      sessionId: file.sessionId,
      name: file.name ?? git.worktree ?? git.project,
      title: state?.title ?? null,
      cwd: file.cwd,
      project: git.project,
      worktree: git.worktree,
      branch: state?.branch ?? null,
      model: state?.model ?? null,
      status,
      activity,
      needsYou,
      currentTool,
      lastPrompt: state?.lastPrompt ?? null,
      lastError: state?.lastError ?? null,
      contextTokens: state?.contextTokens ?? 0,
      startedAt: file.startedAt,
      lastActivityAt: Math.max(state?.lastRecordAt ?? 0, file.statusUpdatedAt ?? 0),
      idleSince,
      recent: state?.recent.slice(-25) ?? [],
      subagents,
      app: agent.host.app,
      orca: this.orcaLink(agent),
    };
  }

  private orcaLink(agent: Agent): OrcaLink | null {
    const terminal = this.orca.terminalFor(agent.host);
    if (!terminal) return null;
    const worktree = this.orca.worktreeFor(agent.host);
    return {
      writable: terminal.writable,
      worktreeName: worktree?.name ?? null,
      status: worktree?.status ?? null,
      comment: worktree?.comment ?? null,
    };
  }

  private terminalOf(id: string) {
    const agent = this.agents.get(Number(id));
    if (!agent) throw new OrcaError("That session is no longer running.", "gone");
    const terminal = this.orca.terminalFor(agent.host);
    if (!terminal) {
      const where = agent.host.app && agent.host.app !== "Orca" ? ` It is running in ${agent.host.app}.` : "";
      throw new OrcaError(`This session is not in an Orca terminal, so the office can only watch it.${where}`, "not_orca");
    }
    return terminal;
  }

  /** What the agent's terminal screen shows right now. */
  async readTerminal(id: string): Promise<TerminalView> {
    return { lines: await this.orca.screen(this.terminalOf(id).handle) };
  }

  /** The session's earlier activity, from its transcript, for scrolling back on the terminal screen. */
  async scrollback(id: string): Promise<ScrollbackView> {
    const agent = this.agents.get(Number(id));
    if (!agent) throw new OrcaError("That session is no longer running.", "gone");
    return { entries: agent.tail ? await readScrollback(agent.tail.path) : [] };
  }

  /** Brings the agent's terminal to the front in Orca. */
  async focus(id: string) {
    await this.orca.focus(this.terminalOf(id).handle);
  }

  /** Types a message into the agent's terminal as a new prompt. */
  async message(id: string, text: string): Promise<SendResult> {
    if (READ_ONLY) throw new OrcaError("This office was started read-only.", "read_only");
    const terminal = this.terminalOf(id);
    if (!terminal.writable) throw new OrcaError("Orca reports this terminal is not accepting input.", "not_writable");
    if (this.current.agents.find((a) => a.id === id)?.needsYou) {
      throw new OrcaError("This agent is showing a prompt. Answer it in Orca first.", "dialog_open");
    }
    // A newline typed into a terminal submits, so a message is always one line.
    const clean = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (!clean) throw new OrcaError("The message is empty.", "empty");
    if (clean.length > MAX_MESSAGE_LENGTH) {
      throw new OrcaError(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`, "too_long");
    }
    return this.orca.send(terminal.handle, clean);
  }
}
