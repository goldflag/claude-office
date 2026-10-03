import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ActionEntry, AgentSnapshot } from "../../shared/types.ts";
import { looksLikeDialog } from "../../shared/terminal.ts";
import { openInOrca, readScrollback, readTerminal, sendMessage } from "../api.ts";
import { describeAgent, groupOf, tokens } from "../describe.ts";

interface Props {
  agent: AgentSnapshot;
  canSend: boolean;
  onClose(): void;
}

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; note: string } | { kind: "error"; note: string };

const SCREEN_MS = 1000;
const SCROLLBACK_MS = 10_000;
/** Width of the screen pieced together for sessions whose terminal cannot be read. */
const SIM_COLS = 100;
const RULE = /^\s*[─━═]{12,}\s*$/;
/** Long enough to cross any screen; the stylesheet clips it to the width. */
const RULE_FILL = "─".repeat(400);

/** Unsent text per agent, kept while you look at other terminals. */
const drafts = new Map<string, string>();

/** Reads something now and again every `ms` while `on`, and on demand through `refresh`. */
function usePoll<T>(load: () => Promise<T>, ms: number, on: boolean, key: string) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await load();
        if (cancelled) return;
        setValue(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
      if (!cancelled) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `load` is a fresh closure every render, so `key` stands in for what it reads.
  }, [key, ms, on, nonce]);

  return { value, error, refresh: () => setNonce((n) => n + 1) };
}

/** Wraps one line of text to `width`, with a prefix on the first row and an indent on the rest. */
function wrap(text: string, prefix: string, indent: string, width: number): string[] {
  const lead = /^\s*/.exec(text)![0];
  const out: string[] = [];
  let line = prefix + lead;
  let empty = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > width) {
      out.push(line);
      line = indent + lead;
      empty = true;
    }
    line += (empty ? "" : " ") + word;
    empty = false;
  }
  out.push(line);
  return out;
}

/** Wraps text that may run over several lines, dropping the markdown markers Claude Code would have rendered. */
function block(text: string, prefix: string, indent: string, width: number): string[] {
  return text
    .replace(/\*\*|`/g, "")
    .split("\n")
    .flatMap((para, i) => wrap(para, i === 0 ? prefix : indent, indent, width));
}

/** Transcript entries drawn the way Claude Code draws them. */
function renderEntries(entries: ActionEntry[], width: number): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "prompt") lines.push("", ...block(entry.detail, "> ", "  ", width), "");
    else if (entry.kind === "text") lines.push(...block(entry.detail, "⏺ ", "  ", width), "");
    else if (entry.kind === "error") lines.push(...block(entry.detail, "  ⎿  Error: ", "     ", width));
    else lines.push(entry.detail ? `⏺ ${entry.label}(${entry.detail})` : `⏺ ${entry.label}`);
  }
  return lines;
}

/** A Claude Code screen pieced together from the session files, for agents whose terminal cannot be read. */
function simulate(agent: AgentSnapshot, entries: ActionEntry[]): string[] {
  const home = agent.cwd.replace(/^\/Users\/[^/]+/, "~");
  const inner = Math.max(46, home.length + 10);
  const row = (text = "") => `│ ${text.padEnd(inner - 2)} │`;
  const rule = "─".repeat(SIM_COLS);
  const lines = [
    `╭${"─".repeat(inner)}╮`,
    row("✻ Claude Code"),
    row(),
    row(`  ${agent.name}${agent.model ? ` · ${agent.model.replace(/^claude-/, "")}` : ""}`),
    row(`  cwd: ${home}`),
    `╰${"─".repeat(inner)}╯`,
    "",
    ...renderEntries(entries, SIM_COLS),
  ];
  if (agent.needsYou) lines.push("", ...block(agent.needsYou.message, "⚠ ", "  ", SIM_COLS));
  else if (groupOf(agent.activity) === "working") lines.push("", `✻ ${describeAgent(agent)}…`);
  lines.push("", rule, "❯ ", rule, `  ${tokens(agent.contextTokens)} tokens of context`);
  return lines;
}

/** Letters and digits only, so markdown and line wrapping do not hide a match. */
const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * How many entries have scrolled off the live screen. The screen shows the
 * end of the conversation, so this walks back from the last prompt or reply
 * it can find on it to the first one it cannot.
 */
function offscreen(entries: ActionEntry[], screen: string[]): number {
  const shown = bare(screen.join(" "));
  const probe = (e: ActionEntry) => (e.kind === "prompt" || e.kind === "text" ? bare(e.detail).slice(0, 32) : "");
  const onScreen = (e: ActionEntry) => {
    const p = probe(e);
    return p.length >= 12 && shown.includes(p);
  };
  let i = entries.length - 1;
  while (i >= 0 && !onScreen(entries[i]!)) i--;
  if (i < 0) return entries.length;
  while (i > 0 && (onScreen(entries[i - 1]!) || !probe(entries[i - 1]!))) i--;
  return i;
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
function Row({ line, kind = kindOf(line) }: { line: string; kind?: string }) {
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

/** Rows above the live screen. Kept apart so the screen refreshing every second does not redraw them. */
const Rows = memo(function Rows({ lines }: { lines: string[] }) {
  return lines.map((line, i) => <Row key={i} line={line} />);
});

/**
 * The agent's terminal, filling the view. Sessions that Orca launched show
 * their live screen and take typed prompts; others show a screen pieced
 * together from the session files and can only be watched. Either way,
 * scrolling up goes back through the session's transcript.
 */
export function AgentTerminal({ agent, canSend, onClose }: Props) {
  const live = agent.orca !== null;
  const screen = usePoll(() => readTerminal(agent.id).then((v) => v.lines), SCREEN_MS, live, agent.id);
  const scrollback = usePoll(() => readScrollback(agent.id), SCROLLBACK_MS, true, agent.id);
  const [draft, setDraft] = useState(() => drafts.get(agent.id) ?? "");
  const [caret, setCaret] = useState(draft.length);
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** Whether the view follows the bottom, as a terminal does until you scroll up. */
  const pinned = useRef(true);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  // Until the transcript is read, or when it has nothing, the snapshot's recent activity stands in.
  const history = scrollback.value?.length ? scrollback.value : agent.recent;
  const shown = live && screen.value ? screen.value : null;
  const lines = shown ?? (live && !screen.error ? [] : simulate(agent, history));
  const cols = shown ? Math.max(80, ...shown.map((l) => l.length)) : SIM_COLS;
  // Above a live screen, the transcript fills in what has scrolled off it.
  const cut = shown ? offscreen(history, shown) : 0;
  const older = useMemo(() => renderEntries(history.slice(0, cut), cols), [history, cut, cols]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });

  const dialog = shown !== null && looksLikeDialog(shown);
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

  const toBottom = () => {
    pinned.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const edit = (value: string, at: number | null) => {
    setDraft(value);
    setCaret(at ?? value.length);
    drafts.set(agent.id, value);
    if (phase.kind !== "sending") setPhase({ kind: "idle" });
    toBottom();
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
      // Escape cancels the composition here, rather than closing the terminal.
      if (event.key === "Escape") event.stopPropagation();
      return;
    }
    const el = scroller.current;
    if ((event.key === "PageUp" || event.key === "PageDown") && el) {
      event.preventDefault();
      el.scrollBy({ top: (event.key === "PageUp" ? -0.9 : 0.9) * el.clientHeight });
    } else if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  // Claude Code's own prompt box is replaced with one showing what is typed here.
  const box = findPrompt(lines);
  const rows = box ? lines.slice(0, box.start) : lines;
  const after = box ? lines.slice(box.end) : [];
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
                    ? `Enter queues a message behind the current step · PageUp scrolls back`
                    : `Enter sends · PageUp scrolls back`,
              };

  return (
    <div
      className="term"
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.name}'s terminal`}
      style={{ "--cols": cols } as CSSProperties}
    >
      <div
        ref={scroller}
        className="term-screen"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
        }}
        onMouseUp={() => {
          // Clicking the screen puts the cursor back in the prompt, unless you were selecting text to copy.
          if (window.getSelection()?.isCollapsed !== false) input.current?.focus({ preventScroll: true });
        }}
      >
        <div className="term-lines">
          <Rows lines={older} />
          {rows.map((line, i) => (
            <Row key={i} line={line} />
          ))}
          {(box || !dialog) && (
            <>
              {!box && <Row line="" kind="rule" />}
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
              {!box && <Row line="" kind="rule" />}
              {after.map((line, i) => (
                <Row key={i} line={line} kind={i === 0 ? "rule" : "footer"} />
              ))}
            </>
          )}
        </div>
      </div>
      <input
        ref={input}
        className="term-input"
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
      <div className="term-bar">
        <span className="term-name">{agent.name}</span>
        <span className="term-status" data-kind={status.kind} role="status" title={status.note}>
          {status.note}
        </span>
        {agent.orca && (
          <button type="button" onClick={open}>
            Open in Orca
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close the terminal">
          Esc
        </button>
      </div>
    </div>
  );
}
