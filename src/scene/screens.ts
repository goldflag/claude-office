import * as THREE from "three/webgpu";
import type { ActionEntry, AgentSnapshot, SubagentSnapshot } from "../../shared/types.ts";
import { block } from "../../shared/terminal.ts";
import { describeWork, groupOf } from "../describe.ts";

const W = 512;
const H = 320;
const FONT_PX = 12;
const LINE = 15;
const PAD_X = 10;
const PAD_Y = 8;
const ROWS = Math.floor((H - PAD_Y * 2) / LINE);
const FONT = `${FONT_PX}px Menlo, "SF Mono", ui-monospace, Consolas, monospace`;
/** A long reply would push everything else off the little screen, so it is cut short. */
const TEXT_ROWS = 6;

// Claude Code's dark theme.
const C = {
  bg: "#1A1918",
  off: "#0F1114",
  fg: "#E6E2DC",
  dim: "#8C8984",
  faint: "#56534F",
  claude: "#D77757",
  shimmer: "#F7B79C",
  ok: "#4EBA65",
  err: "#FF6B80",
  ask: "#B1B9F9",
  userBg: "#2C2B29",
};

const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const VERBS = [
  "Thinking", "Cogitating", "Pondering", "Noodling", "Percolating", "Musing", "Brewing", "Tinkering",
  "Clauding", "Spelunking", "Wrangling", "Simmering", "Mulling", "Synthesizing", "Conjuring", "Moseying",
];

/** A run of text in one style; `cursor` draws the blinking block, `blink` a dot that pulses. */
interface Span {
  text: string;
  color: string;
  bold?: boolean;
  fx?: "cursor" | "blink";
}

interface Row {
  spans: Span[];
  bg?: string;
}

const span = (text: string, color = C.fg, extra: Partial<Span> = {}): Span => ({ text, color, ...extra });
const row = (...spans: Span[]): Row => ({ spans });
const BLANK: Row = { spans: [] };
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, Math.max(0, n - 1))}…` : text);
const toolLabel = (name: string) => name.replace(/^mcp__(.+?)__/, "$1: ");

/** Rows framed in a rounded box, the way Claude Code draws its welcome banner and dialogs. */
function boxed(lines: Span[][], width: number, border: string): Row[] {
  const inner = width - 4;
  const edge = (l: string, r: string) => row(span(l + "─".repeat(width - 2) + r, border));
  return [
    edge("╭", "╮"),
    ...lines.map((spans) => {
      let room = inner;
      const fitted = spans.map((s) => {
        const text = clip(s.text, room);
        room -= text.length;
        return { ...s, text };
      });
      return row(span("│ ", border), ...fitted, span(" ".repeat(room) + " │", border));
    }),
    edge("╰", "╯"),
  ];
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The transcript, newest last, drawn the way Claude Code draws it. */
function transcript(agent: AgentSnapshot, working: boolean, cols: number): Row[] {
  const home = agent.cwd.replace(/^\/Users\/[^/]+/, "~");
  const rows: Row[] = [
    ...boxed(
      [
        [span("✻", C.claude), span(" Welcome to "), span("Claude Code", C.fg, { bold: true }), span("!")],
        [],
        [span(`  cwd: ${home}`, C.dim)],
      ],
      Math.min(cols, Math.max(34, home.length + 13)),
      C.claude,
    ),
    BLANK,
  ];

  const entries: ActionEntry[] = [...agent.recent];
  const tool = working ? agent.currentTool : null;
  let running = -1;
  if (tool) {
    const label = toolLabel(tool.name);
    running = entries.findLastIndex((e) => e.kind === "tool");
    const last = entries[running];
    if (!last || last.label !== label || last.detail !== tool.summary || entries.slice(running).some((e) => e.kind !== "tool")) {
      entries.push({ at: tool.startedAt, kind: "tool", label, detail: tool.summary });
      running = entries.length - 1;
    }
  }

  // Subagents hang under the call that started them when it can be found, and under the newest call otherwise.
  const subs = new Map<string, SubagentSnapshot>();
  for (const sub of working ? agent.subagents : []) subs.set(sub.description, sub);
  const subRows = (sub: SubagentSnapshot) =>
    row(span("  ⎿  ", C.dim), span(clip(`${sub.description}: ${describeWork(sub.activity, sub.currentTool)}`, cols - 5), C.dim));

  entries.forEach((entry, i) => {
    if (entry.kind === "prompt") {
      const lines = block(entry.detail, "> ", "  ", cols - 1).slice(-3);
      rows.push(...lines.map((text) => ({ spans: [span(text.padEnd(cols), C.dim)], bg: C.userBg })), BLANK);
    } else if (entry.kind === "text") {
      let lines = block(entry.detail, "  ", "  ", cols);
      if (lines.length > TEXT_ROWS) lines = [...lines.slice(0, TEXT_ROWS - 1), "  …"];
      lines.forEach((text, j) => rows.push(row(span(j === 0 ? "⏺" : " ", C.fg), span(text.slice(1)))));
      rows.push(BLANK);
    } else if (entry.kind === "error") {
      const lines = block(entry.detail, "Error: ", "", cols - 5).slice(0, 2);
      lines.forEach((text, j) => rows.push(row(span(j === 0 ? "  ⎿  " : "     ", C.dim), span(text, C.err))));
    } else {
      const failed = entries[i + 1]?.kind === "error";
      const live = i === running;
      const args = entry.detail ? `(${clip(entry.detail, cols - entry.label.length - 4)})` : "";
      rows.push(
        row(
          span("⏺", live ? C.fg : failed ? C.err : C.ok, live ? { fx: "blink" } : {}),
          span(" "),
          span(entry.label, C.fg, { bold: true }),
          span(args, C.fg),
        ),
      );
      const sub = subs.get(entry.detail);
      if (sub) {
        rows.push(subRows(sub));
        subs.delete(entry.detail);
      } else if (live && entry.label === "Bash" && subs.size === 0) {
        rows.push(row(span("  ⎿  ", C.dim), span("Running…", C.dim)));
      }
      if (live) for (const left of subs.values()) rows.push(subRows(left));
      if (live) subs.clear();
    }
  });
  // Subagents whose call could not be found get rows of their own.
  for (const sub of subs.values()) {
    rows.push(row(span("⏺", C.fg, { fx: "blink" }), span(" "), span("Task", C.fg, { bold: true }), span(`(${clip(sub.description, cols - 8)})`)));
    rows.push(subRows(sub));
  }
  return rows;
}

/** What sits under the transcript: the prompt box, or the dialog that is waiting on you. */
function footer(agent: AgentSnapshot, cols: number): { rows: Row[]; dialog: boolean } {
  const ask = agent.needsYou;
  if (ask) {
    const lines: Span[][] = [];
    const option = (n: number, text: string) => [span(n === 1 ? "❯ " : "  ", C.ask), span(`${n}. ${text}`, n === 1 ? C.ask : C.fg)];
    if (ask.reason === "plan") {
      lines.push([span("Ready to code?", C.ask, { bold: true })], [], [span("Would you like to proceed?")]);
      lines.push(option(1, "Yes, and auto-accept edits"), option(2, "Yes, manually approve edits"), option(3, "No, keep planning"));
    } else if (ask.reason === "question") {
      lines.push([span("☐ ", C.ask), span("Question", C.ask, { bold: true })], []);
      lines.push(...block(ask.message, "", "", cols - 4).slice(0, 3).map((t) => [span(t)]));
      lines.push([], [span("Enter to select · ↑/↓ to navigate · Esc to cancel", C.dim)]);
    } else {
      const tool = agent.currentTool;
      const bash = tool?.name === "Bash";
      lines.push([span(bash ? "Bash command" : "Tool use", C.ask, { bold: true })], []);
      if (tool) lines.push([span(`  ${bash ? tool.summary : `${toolLabel(tool.name)}(${tool.summary})`}`)]);
      else lines.push([span(`  ${ask.message}`, C.dim)]);
      lines.push([], [span("Do you want to proceed?")]);
      lines.push(option(1, "Yes"), option(2, "Yes, and don't ask again this session"), option(3, "No, and tell Claude what to do differently"));
    }
    return { rows: boxed(lines, cols, C.ask), dialog: true };
  }

  const rule = row(span("─".repeat(cols), C.faint));
  const model = (agent.model ?? "")
    .replace(/^claude-|-\d{8}$|\[.*\]$/g, "")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/^\w/, (ch) => ch.toUpperCase());
  const hint = "  ? for shortcuts";
  return {
    rows: [
      rule,
      row(span("> ", C.fg), span(" ", C.fg, { fx: "cursor" })),
      rule,
      row(span(hint, C.dim), span(model.padStart(cols - hint.length), C.dim)),
    ],
    dialog: false,
  };
}

/** A monitor face: a little Claude Code terminal showing the agent's session. */
export class Screen {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private charW: number;
  private cols: number;
  private agent: AgentSnapshot | null = null;
  private rows: Row[] = [];
  private working = false;
  private turnStart = 0;
  private verb = VERBS[0]!;
  /** Row the spinner takes, or -1 when there is none. */
  private spinnerAt = -1;
  private version = 0;
  private drawn = "";

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.font = FONT;
    this.charW = this.ctx.measureText("M").width;
    this.cols = Math.floor((W - PAD_X * 2) / this.charW);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
  }

  private layout(agent: AgentSnapshot) {
    this.agent = agent;
    this.working = groupOf(agent.activity) === "working";
    this.version++;
    const { rows, dialog } = footer(agent, this.cols);
    // While Claude works, the spinner sits between blank rows above the prompt box.
    const spin = this.working && !dialog;
    this.rows = [...transcript(agent, this.working, this.cols), ...(spin ? [BLANK, BLANK, BLANK] : [BLANK]), ...rows];
    this.spinnerAt = spin ? this.rows.length - rows.length - 2 : -1;
    const prompt = agent.recent.findLast((e) => e.kind === "prompt");
    this.turnStart = prompt?.at ?? agent.currentTool?.startedAt ?? agent.lastActivityAt;
    this.verb = VERBS[Math.floor(this.turnStart / 1000) % VERBS.length]!;
  }

  /** Redraws when something on it changes; `on` false is a monitor that is switched off. */
  draw(agent: AgentSnapshot, on: boolean, t: number) {
    if (!on) {
      if (this.drawn === "off") return;
      this.drawn = "off";
      this.agent = null;
      this.ctx.fillStyle = C.off;
      this.ctx.fillRect(0, 0, W, H);
      this.texture.needsUpdate = true;
      return;
    }
    if (agent !== this.agent) this.layout(agent);

    const frame = Math.floor(t * 8);
    const blink = Math.floor(t * 2) % 2 === 0;
    const since = elapsed(Date.now() - this.turnStart);
    const key = `${this.version}|${this.spinnerAt < 0 ? "" : `${frame}|${since}`}|${blink}`;
    if (key === this.drawn) return;
    this.drawn = key;

    const rows = [...this.rows];
    if (this.spinnerAt >= 0) rows[this.spinnerAt] = this.spinner(frame, since);

    const c = this.ctx;
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    c.textBaseline = "middle";
    rows.slice(-ROWS).forEach((r, i) => {
      const y = PAD_Y + i * LINE;
      if (r.bg) {
        c.fillStyle = r.bg;
        c.fillRect(0, y, W, LINE);
      }
      let x = PAD_X;
      for (const s of r.spans) {
        if (s.fx === "cursor") {
          if (blink) {
            c.fillStyle = s.color;
            c.fillRect(x, y + 1, this.charW, LINE - 2);
          }
        } else if (s.text.trim()) {
          c.font = s.bold ? `bold ${FONT}` : FONT;
          c.fillStyle = s.fx === "blink" && !blink ? C.faint : s.color;
          c.fillText(s.text, x, y + LINE / 2);
        }
        x += s.text.length * this.charW;
      }
    });
    this.texture.needsUpdate = true;
  }

  /** "✻ Noodling… (12s · esc to interrupt)", with the shimmer that sweeps across the verb. */
  private spinner(frame: number, since: string): Row {
    const word = `${this.verb}…`;
    const sweep = (frame % (word.length + 8)) - 4;
    return row(
      span(SPINNER[frame % SPINNER.length]!, C.claude),
      span(" "),
      ...[...word].map((ch, i) => span(ch, Math.abs(i - sweep) <= 1 ? C.shimmer : C.claude)),
      span(` (${since} · esc to interrupt)`, C.dim),
    );
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}
