import { type CSSProperties, type KeyboardEvent, type Ref, useEffect, useRef, useState } from "react";
import type { AgentSnapshot } from "../../shared/types.ts";
import { looksLikeDialog } from "../../shared/terminal.ts";
import { openInOrca, readTerminal, sendMessage } from "../api.ts";
import { describeAgent, groupOf, tokens } from "../describe.ts";

interface Props {
  agent: AgentSnapshot;
  canSend: boolean;
  onClose(): void;
  /** The scene positions this element over the agent's monitor. */
  ref: Ref<HTMLDivElement>;
}

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; note: string } | { kind: "error"; note: string };

const POLL_MS = 1000;
const SIM_COLS = 100;
const RULE = /^\s*[─━═]{12,}\s*$/;
const RULE_LINE = "─".repeat(SIM_COLS);
/** Long enough to cross any screen; the stylesheet clips it to the width. */
const RULE_FILL = "─".repeat(400);

/** Unsent text per agent, kept while you look at other screens. */
const drafts = new Map<string, string>();

/** The agent's live terminal screen from Orca, read again every second while the monitor is open. */
function useScreen(agentId: string, live: boolean) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const view = await readTerminal(agentId);
        if (cancelled) return;
        setLines(view.lines);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
      if (!cancelled) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentId, live, nonce]);

  return { lines, error, refresh: () => setNonce((n) => n + 1) };
}

/** Wraps text to the simulated screen's width, with a prefix on the first line and an indent on the rest. */
function wrap(text: string, prefix: string, indent: string): string[] {
  const out: string[] = [];
  let line = prefix;
  let empty = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > SIM_COLS) {
      out.push(line);
      line = indent;
      empty = true;
    }
    line += (empty ? "" : " ") + word;
    empty = false;
  }
  out.push(line);
  return out;
}

/** A Claude Code screen pieced together from the session files, for agents whose terminal cannot be read. */
function simulate(agent: AgentSnapshot): string[] {
  const home = agent.cwd.replace(/^\/Users\/[^/]+/, "~");
  const inner = Math.max(46, home.length + 10);
  const row = (text = "") => `│ ${text.padEnd(inner - 2)} │`;
  const lines = [
    `╭${"─".repeat(inner)}╮`,
    row("✻ Claude Code"),
    row(),
    row(`  ${agent.name}${agent.model ? ` · ${agent.model.replace(/^claude-/, "")}` : ""}`),
    row(`  cwd: ${home}`),
    `╰${"─".repeat(inner)}╯`,
    "",
  ];
  for (const entry of agent.recent) {
    if (entry.kind === "prompt") lines.push(...wrap(entry.detail, "> ", "  "), "");
    else if (entry.kind === "text") lines.push(...wrap(entry.detail, "⏺ ", "  "), "");
    else if (entry.kind === "error") lines.push(...wrap(entry.detail, "  ⎿  Error: ", "     "));
    else lines.push(entry.detail ? `⏺ ${entry.label}(${entry.detail})` : `⏺ ${entry.label}`);
  }
  if (agent.needsYou) lines.push("", ...wrap(agent.needsYou.message, "⚠ ", "  "));
  else if (groupOf(agent.activity) === "working") lines.push("", `✻ ${describeAgent(agent)}…`);
  lines.push("", RULE_LINE, "❯ ", RULE_LINE, `  ${tokens(agent.contextTokens)} tokens of context`);
  return lines;
}

/** Where Claude Code's prompt box is: the rows between the last two rules, starting with ❯. */
function findPrompt(lines: string[]): { start: number; end: number } | null {
  let below = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!RULE.test(lines[i]!)) continue;
    if (below < 0) below = i;
    else return below - i >= 2 && /^[❯>]/.test(lines[i + 1]!) ? { start: i + 1, end: below } : null;
  }
  return null;
}

function kindOf(line: string): string | undefined {
  if (RULE.test(line)) return "rule";
  if (/^\s*⎿\s+Error/.test(line)) return "error";
  if (/^\s*⎿/.test(line)) return "result";
  if (/^\s+\d+\s+\+/.test(line)) return "add";
  if (/^\s+\d+\s+-/.test(line)) return "del";
  if (/^[✻✳✶✢✽·*] \S.*…/.test(line)) return "spinner";
  if (/^⏺/.test(line)) return "say";
  if (/^[>›] /.test(line)) return "you";
  if (/^⚠/.test(line)) return "warn";
  return undefined;
}

/** One screen row, with a colored lead glyph on the rows that have one. */
function Row({ line, kind }: { line: string; kind: string | undefined }) {
  if (kind === "say" || kind === "spinner" || kind === "warn") {
    const [lead, ...rest] = line;
    return (
      <div className="tl" data-kind={kind}>
        <span className="lead">{lead}</span>
        {rest.join("")}
      </div>
    );
  }
  return (
    <div className="tl" data-kind={kind}>
      {kind === "rule" ? RULE_FILL : line || " "}
    </div>
  );
}

/**
 * The agent's terminal, drawn onto its monitor. Sessions that Orca launched
 * show their live screen and take typed prompts; others show a screen pieced
 * together from the session files and can only be watched.
 */
export function MonitorTerminal({ agent, canSend, onClose, ref }: Props) {
  const live = agent.orca !== null;
  const screen = useScreen(agent.id, live);
  const [draft, setDraft] = useState(() => drafts.get(agent.id) ?? "");
  const [caret, setCaret] = useState(draft.length);
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const lines = live && screen.lines ? screen.lines : live && !screen.error ? [] : simulate(agent);
  const dialog = live && screen.lines !== null && looksLikeDialog(screen.lines);
  const asking = agent.needsYou !== null || dialog;

  const blocked = !agent.orca
    ? `Watch only. ${agent.name} is running in ${agent.app ?? "a terminal outside Orca"}; sessions started from Orca can be typed into.`
    : asking
      ? `${agent.name} is showing a prompt. A message typed now would answer it by accident, so answer it in Orca.`
      : !agent.orca.writable
        ? "Orca reports this terminal is not accepting input right now."
        : !canSend
          ? "This office was started read-only."
          : null;
  const editable = blocked === null;

  const open = () => openInOrca(agent.id).catch((err: Error) => setPhase({ kind: "error", note: err.message }));

  const edit = (value: string, at: number | null) => {
    setDraft(value);
    setCaret(at ?? value.length);
    drafts.set(agent.id, value);
    if (phase.kind !== "sending") setPhase({ kind: "idle" });
  };

  const submit = async () => {
    const message = draft.trim();
    if (!message || phase.kind === "sending") return;
    setPhase({ kind: "sending" });
    try {
      const { started } = await sendMessage(agent.id, message);
      setDraft("");
      setCaret(0);
      drafts.delete(agent.id);
      setPhase({
        kind: "sent",
        note: started ? `Sent. ${agent.name} has started on it.` : `Sent. It is queued until ${agent.name} is free.`,
      });
      screen.refresh();
    } catch (err) {
      setPhase({ kind: "error", note: (err as Error).message });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      // Escape cancels the composition here, rather than leaving the screen.
      if (event.key === "Escape") event.stopPropagation();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  // Replace Claude Code's own prompt box contents with what is being typed here.
  const box = findPrompt(lines);
  const rows = box ? lines.slice(0, box.start) : lines;
  const after = box ? lines.slice(box.end) : [];
  const cols = Math.max(80, ...lines.map((l) => l.length));

  const placeholder = !agent.orca ? "watch only" : asking ? "answer in Orca" : "";
  const before = draft.slice(0, caret);
  const under = draft.slice(caret, caret + 1) || " ";
  const rest = draft.slice(caret + 1);

  const status =
    phase.kind === "sending"
      ? { kind: "sending", note: "Sending" }
      : phase.kind === "sent" || phase.kind === "error"
        ? phase
        : blocked
          ? { kind: "blocked", note: blocked }
          : screen.error
            ? { kind: "error", note: `Could not read the terminal: ${screen.error}` }
            : {
                kind: "hint",
                note:
                  groupOf(agent.activity) === "working"
                    ? `Enter queues a message behind ${agent.name}'s current step`
                    : `Enter sends to ${agent.name}`,
              };

  return (
    <div ref={ref} className="monitor" style={{ "--cols": cols } as CSSProperties}>
      <div
        className="monitor-screen"
        onMouseUp={() => {
          // Clicking the screen puts the cursor back in the prompt, unless you were selecting text to copy.
          if (window.getSelection()?.isCollapsed !== false) input.current?.focus({ preventScroll: true });
        }}
      >
        {rows.map((line, i) => (
          <Row key={i} line={line} kind={kindOf(line)} />
        ))}
        {(box || !dialog) && (
          <>
            {!box && <Row line={RULE_LINE} kind="rule" />}
            <div className="tl prompt">
              <span className="lead">❯</span>{" "}
              {editable ? (
                <>
                  {before}
                  <span className="caret" data-on={focused ? "1" : "0"}>
                    {under}
                  </span>
                  {rest}
                </>
              ) : (
                <span className="placeholder">{draft || placeholder}</span>
              )}
            </div>
            {!box && <Row line={RULE_LINE} kind="rule" />}
            {after.map((line, i) => (
              <Row key={i} line={line} kind={i === 0 ? "rule" : "footer"} />
            ))}
          </>
        )}
      </div>
      <input
        ref={input}
        className="monitor-input"
        aria-label={`Message ${agent.name}`}
        value={draft}
        readOnly={!editable || phase.kind === "sending"}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => edit(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? draft.length)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className="monitor-bar">
        <span className="monitor-status" data-kind={status.kind} role="status" title={status.note}>
          {status.note}
        </span>
        {agent.orca && (
          <button type="button" onClick={open}>
            Open in Orca
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Leave the screen">
          Esc
        </button>
      </div>
    </div>
  );
}
