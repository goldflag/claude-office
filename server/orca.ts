// The bridge to Orca. Sessions that Orca launched carry their terminal handle
// in their environment, which lets the office address the exact terminal a
// Clawd stands for through the `orca` CLI.

const ORCA_BIN = process.env.ORCA_BIN ?? "orca";
const POLL_MS = 5000;
const POLL_BACKOFF_MS = 30_000;

export class OrcaError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Runs one `orca` command and returns its JSON result. Arguments are never passed through a shell. */
async function orca(args: string[], timeoutMs = 10_000): Promise<any> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([ORCA_BIN, ...args, "--json"], { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  } catch {
    throw new OrcaError("The orca command was not found on this machine.", "orca_missing");
  }
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  let parsed: any = null;
  try {
    parsed = JSON.parse(out);
  } catch {
    // Handled below as a failed command.
  }
  if (code !== 0 || !parsed?.ok) {
    throw new OrcaError(parsed?.error?.message ?? (err.trim() || `orca exited with code ${code}`), parsed?.error?.code ?? null);
  }
  return parsed.result;
}

/** Where a session's process is running, read from its environment. */
export interface ProcessHost {
  /** Display name of the app hosting the terminal, when recognized. */
  app: string | null;
  handle: string | null;
  tabId: string | null;
  worktreeId: string | null;
}

const TERMINAL_APPS: Record<string, string> = {
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm",
  WarpTerminal: "Warp",
  ghostty: "Ghostty",
  WezTerm: "WezTerm",
  tmux: "tmux",
};

export async function inspectProcess(pid: number): Promise<ProcessHost> {
  const none: ProcessHost = { app: null, handle: null, tabId: null, worktreeId: null };
  try {
    const proc = Bun.spawn(["ps", "eww", "-o", "command=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
    const env = await new Response(proc.stdout).text();
    const value = (name: string) => new RegExp(`(?:^|\\s)${name}=(\\S+)`).exec(env)?.[1] ?? null;
    const handle = value("ORCA_TERMINAL_HANDLE");
    if (handle) return { app: "Orca", handle, tabId: value("ORCA_TAB_ID"), worktreeId: value("ORCA_WORKTREE_ID") };
    const program = value("TERM_PROGRAM");
    if (program === "vscode") return { ...none, app: /Cursor/.test(env) ? "Cursor" : "VS Code" };
    return { ...none, app: program ? (TERMINAL_APPS[program] ?? null) : null };
  } catch {
    return none;
  }
}

export interface OrcaTerminal {
  handle: string;
  writable: boolean;
}

export interface OrcaWorktree {
  name: string | null;
  status: string | null;
  comment: string | null;
}

/** A terminal screen that is showing a menu or dialog rather than the prompt box. */
const DIALOG = /❯\s*\d+\.\s|Esc to cancel|Enter to select|Do you want to /;

export const looksLikeDialog = (lines: string[]) => DIALOG.test(lines.slice(-25).join("\n"));

/** Cached view of Orca's terminals and worktrees, refreshed while anyone needs it. */
export class Orca {
  private terminals = new Map<string, OrcaTerminal>();
  private handleByTab = new Map<string, string>();
  private worktrees = new Map<string, OrcaWorktree>();
  private nextPoll = 0;
  private polling = false;
  available = false;

  /** Refreshes the cache if it is stale. Cheap to call on every tick. */
  async refresh(now: number) {
    if (this.polling || now < this.nextPoll) return;
    this.polling = true;
    try {
      const [terms, trees] = await Promise.all([orca(["terminal", "list"]), orca(["worktree", "ps"])]);
      this.terminals.clear();
      this.handleByTab.clear();
      for (const t of terms?.terminals ?? []) {
        this.terminals.set(t.handle, { handle: t.handle, writable: t.writable !== false && t.connected !== false });
        if (t.tabId) this.handleByTab.set(t.tabId, t.handle);
      }
      this.worktrees.clear();
      for (const w of trees?.worktrees ?? []) {
        this.worktrees.set(w.worktreeId, {
          name: w.displayName || null,
          status: w.workspaceStatus || null,
          comment: w.comment || null,
        });
      }
      this.available = true;
      this.nextPoll = now + POLL_MS;
    } catch {
      this.available = false;
      this.nextPoll = now + POLL_BACKOFF_MS;
    } finally {
      this.polling = false;
    }
  }

  /** The live terminal for a session. Handles change when Orca restarts; tab ids do not. */
  terminalFor(host: ProcessHost): OrcaTerminal | null {
    if (!this.available || !host.handle) return null;
    const direct = this.terminals.get(host.handle);
    if (direct) return direct;
    const moved = host.tabId ? this.handleByTab.get(host.tabId) : undefined;
    return moved ? (this.terminals.get(moved) ?? null) : null;
  }

  worktreeFor(host: ProcessHost): OrcaWorktree | null {
    return host.worktreeId ? (this.worktrees.get(host.worktreeId) ?? null) : null;
  }

  async read(handle: string, lines = 40): Promise<string[]> {
    const result = await orca(["terminal", "read", "--terminal", handle, "--limit", String(lines)]);
    const tail: unknown = result?.terminal?.tail;
    return Array.isArray(tail) ? tail.map((line) => String(line).trimEnd()) : [];
  }

  /** Brings the terminal to the front in the Orca window. */
  async focus(handle: string) {
    await orca(["terminal", "switch", "--terminal", handle]);
  }

  /**
   * Types a prompt into an agent's terminal and presses Enter.
   *
   * Refuses when the screen shows a menu or dialog: there, Enter would accept
   * whatever option is highlighted, such as approving a permission request.
   */
  async send(handle: string, text: string): Promise<{ started: boolean }> {
    const screen = await this.read(handle, 30);
    if (looksLikeDialog(screen)) {
      throw new OrcaError("The terminal is showing a prompt. Answer it in Orca first.", "dialog_open");
    }
    const result = await orca(
      ["terminal", "send", "--terminal", handle, "--text", text, "--enter", "--wait-submit", "4"],
      20_000,
    );
    const receipt = JSON.stringify(result ?? {});
    if (/"accepted"\s*:\s*false/.test(receipt)) throw new OrcaError("Orca did not accept the message.", "not_accepted");
    return { started: receipt.includes("turn_started") };
  }
}
