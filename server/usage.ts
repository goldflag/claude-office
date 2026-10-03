import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LimitUsage, PlanLimits, TokenUsage, UsageSnapshot } from "../shared/types.ts";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

const HOUR = 3600_000;
const WEEK = 7 * 24 * HOUR;
const CHUNK_BYTES = 8_000_000;
/** How often the transcripts are checked for new messages. */
const TOKENS_EVERY_MS = 30_000;
const LIMITS_EVERY_MS = 3 * 60_000;
const LIMITS_RETRY_MS = 10 * 60_000;

interface Counted {
  at: number;
  tokens: number;
}

interface FileState {
  offset: number;
  carry: string;
  /** By message id: a message is written once per streamed update, and the last one is the whole. */
  messages: Map<string, Counted>;
}

/** Tokens a message cost to send and receive. Cache reads are left out: they are cheap and would drown the rest. */
export function countTokens(usage: any): number {
  if (!usage || typeof usage !== "object") return 0;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return n(usage.input_tokens) + n(usage.output_tokens) + n(usage.cache_creation_input_tokens);
}

/** Folds one transcript line into the file's messages. Lines that are not billed assistant messages are ignored. */
export function applyUsageLine(messages: Map<string, Counted>, line: string) {
  // Most lines are not assistant messages; this skips parsing them.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
  let rec: any;
  try {
    rec = JSON.parse(line);
  } catch {
    return;
  }
  if (rec?.type !== "assistant") return;
  const msg = rec.message;
  const at = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  const tokens = countTokens(msg?.usage);
  if (!Number.isFinite(at) || tokens === 0) return;
  const id = String(msg.id ?? rec.uuid ?? `${at}`);
  const prev = messages.get(id);
  if (!prev || tokens >= prev.tokens) messages.set(id, { at, tokens });
}

/** Sums tokens by window, counting a message once even when a resumed session copied it into another file. */
export function totalTokens(files: Iterable<FileState>, now: number): TokenUsage {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const seen = new Set<string>();
  const out: TokenUsage = { fiveHours: 0, today: 0, week: 0 };
  for (const file of files) {
    for (const [id, m] of file.messages) {
      if (seen.has(id) || now - m.at > WEEK) continue;
      seen.add(id);
      out.week += m.tokens;
      if (m.at >= midnight) out.today += m.tokens;
      if (now - m.at <= 5 * HOUR) out.fiveHours += m.tokens;
    }
  }
  return out;
}

async function recentTranscripts(now: number): Promise<{ path: string; size: number }[]> {
  const found: { path: string; size: number }[] = [];
  const projects = await readdir(PROJECTS_DIR).catch(() => [] as string[]);
  const walk = async (dir: string, depth: number) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Subagent transcripts sit under <project>/<session>/subagents.
        if (depth < 3) await walk(path, depth + 1);
      } else if (entry.name.endsWith(".jsonl")) {
        const info = await stat(path).catch(() => null);
        if (info && now - info.mtimeMs <= WEEK) found.push({ path, size: info.size });
      }
    }
  };
  await Promise.all(projects.map((p) => walk(join(PROJECTS_DIR, p), 1)));
  return found;
}

/** Reads what a transcript gained since the last look, in chunks so that a huge one never sits in memory whole. */
async function readNew(path: string, size: number, state: FileState) {
  if (size < state.offset) {
    state.offset = 0;
    state.carry = "";
    state.messages.clear();
  }
  if (size === state.offset) return;
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(CHUNK_BYTES, size - state.offset));
    while (state.offset < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - state.offset), state.offset);
      if (bytesRead === 0) break;
      // A chunk may end mid-character, so the cut is made at the last newline, which is always a whole one.
      const end = buf.lastIndexOf(0x0a, bytesRead - 1);
      const take = end === -1 ? bytesRead : end + 1;
      const lines = (state.carry + buf.toString("utf8", 0, take)).split("\n");
      // The last piece is empty after a newline, or a line still being written.
      state.carry = lines.pop()!;
      for (const line of lines) if (line) applyUsageLine(state.messages, line);
      state.offset += take;
    }
  } finally {
    await fh.close();
  }
}

/** The Claude Code OAuth token, which stays inside this process and is only ever sent to Anthropic. */
async function readToken(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  // A custom CLAUDE_CONFIG_DIR keeps its login under a different keychain name, which is not guessed at.
  if (process.env.CLAUDE_CONFIG_DIR) return null;
  try {
    const proc = Bun.spawn(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const raw = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0 || !raw) return null;
    const oauth = JSON.parse(raw)?.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string") return null;
    // Claude Code refreshes its own token; an expired one is not this server's to renew.
    if (typeof oauth.expiresAt === "number" && oauth.expiresAt < Date.now()) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

function limit(raw: any): LimitUsage | null {
  if (typeof raw?.utilization !== "number") return null;
  const resetsAt = raw.resets_at ? Date.parse(raw.resets_at) : NaN;
  return { percent: Math.max(0, Math.min(100, raw.utilization)), resetsAt: Number.isFinite(resetsAt) ? resetsAt : null };
}

/** Parses the usage endpoint's reply. Returns null unless it carries at least one limit. */
export function parseLimits(body: any): PlanLimits | null {
  const fiveHour = limit(body?.five_hour);
  const sevenDay = limit(body?.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

async function fetchLimits(): Promise<{ limits: PlanLimits | null; retryMs: number }> {
  const token = await readToken();
  if (!token) return { limits: null, retryMs: LIMITS_RETRY_MS };
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { limits: null, retryMs: res.status === 429 ? 2 * LIMITS_RETRY_MS : LIMITS_RETRY_MS };
    const limits = parseLimits(await res.json());
    return { limits, retryMs: limits ? LIMITS_EVERY_MS : LIMITS_RETRY_MS };
  } catch {
    return { limits: null, retryMs: LIMITS_RETRY_MS };
  }
}

/**
 * What Claude Code has used: token totals counted from the local transcripts,
 * and, when the OAuth token is readable, the plan's own limits from Anthropic.
 */
export class Usage {
  private files = new Map<string, FileState>();
  private tokens: TokenUsage | null = null;
  private limits: PlanLimits | null = null;
  private busy = false;

  get current(): UsageSnapshot {
    // Re-summed on each read so the windows slide even between scans.
    return { tokens: this.tokens && totalTokens(this.files.values(), Date.now()), limits: this.limits };
  }

  start() {
    const scan = async () => {
      if (!this.busy) {
        this.busy = true;
        try {
          await this.scan();
        } catch (err) {
          console.error("[usage] scan failed", err);
        } finally {
          this.busy = false;
        }
      }
      setTimeout(scan, TOKENS_EVERY_MS);
    };
    void scan();

    const poll = async () => {
      const { limits, retryMs } = await fetchLimits();
      // A failed poll keeps the last good reading rather than blanking the bars.
      if (limits) this.limits = limits;
      else if (retryMs >= LIMITS_RETRY_MS) this.limits = null;
      setTimeout(poll, retryMs);
    };
    void poll();
  }

  private async scan() {
    const now = Date.now();
    const found = await recentTranscripts(now);
    const live = new Set(found.map((f) => f.path));
    for (const path of this.files.keys()) if (!live.has(path)) this.files.delete(path);
    for (const { path, size } of found) {
      let state = this.files.get(path);
      if (!state) this.files.set(path, (state = { offset: 0, carry: "", messages: new Map() }));
      await readNew(path, size, state);
    }
    this.tokens = totalTokens(this.files.values(), Date.now());
  }
}
