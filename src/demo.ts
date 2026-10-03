import type { Activity, AgentSnapshot, OfficeSnapshot, SubagentSnapshot, ToolCall } from "../shared/types.ts";

// A scripted office for `?demo`, so every state can be seen without waiting
// for real sessions to reach it.

const started = Date.now();

const tool = (name: string, summary: string, at: number): ToolCall => ({ id: `${name}-${at}`, name, summary, startedAt: at });

const CYCLE: { activity: Activity; tool: [string, string] | null }[] = [
  { activity: "thinking", tool: null },
  { activity: "reading", tool: ["Read", "checkout.ts"] },
  { activity: "writing", tool: ["Edit", "checkout.ts"] },
  { activity: "terminal", tool: ["Bash", "Run the payment tests"] },
  { activity: "web", tool: ["WebSearch", "stripe idempotency keys"] },
  { activity: "tool", tool: ["mcp__linear__create_issue", ""] },
];

function agent(
  i: number,
  name: string,
  project: string,
  activity: Activity,
  extra: Partial<AgentSnapshot> = {},
): AgentSnapshot {
  const now = Date.now();
  return {
    id: `demo-${i}`,
    pid: 1000 + i,
    sessionId: `demo-session-${i}`,
    name,
    title: null,
    cwd: `/Users/you/code/${project}`,
    project,
    worktree: null,
    branch: "main",
    model: "claude-opus-5-5",
    status: activity === "idle" || activity === "sleeping" || activity === "done" ? "idle" : "busy",
    activity,
    needsYou: null,
    currentTool: null,
    lastPrompt: "Make the checkout flow retry failed payments safely.",
    lastError: null,
    contextTokens: 40_000 + i * 61_000,
    startedAt: started - (i + 1) * 900_000,
    lastActivityAt: now,
    idleSince: null,
    // In the demo, sessions in two of the projects run in Orca and the rest in Cursor.
    app: project === "storefront" || project === "api-server" ? "Orca" : "Cursor",
    orca:
      project === "storefront" || project === "api-server"
        ? { writable: true, worktreeName: `${name} worktree`, status: "in-progress", comment: null }
        : null,
    recent: [
      { at: now - 95_000, kind: "prompt", label: "you", detail: "Make the checkout flow retry failed payments safely." },
      { at: now - 80_000, kind: "tool", label: "Read", detail: "checkout.ts" },
      { at: now - 61_000, kind: "tool", label: "Grep", detail: "retryPayment" },
      { at: now - 40_000, kind: "text", label: "says", detail: "The retry path double-charges when the first attempt times out." },
      { at: now - 22_000, kind: "tool", label: "Edit", detail: "checkout.ts" },
      { at: now - 9_000, kind: "tool", label: "Bash", detail: "Run the payment tests" },
    ],
    subagents: [],
    ...extra,
  };
}

export function demoSnapshot(): OfficeSnapshot {
  const now = Date.now();
  const elapsed = (now - started) / 1000;
  const step = CYCLE[Math.floor(elapsed / 5) % CYCLE.length]!;
  const larkPhase = elapsed % 80;
  const stepTool = step.tool ? tool(step.tool[0], step.tool[1], now - 2000) : null;

  const subs: SubagentSnapshot[] = ["Audit the API routes", "Check the migrations", "Review test coverage"].map((d, i) => ({
    id: `sub-${i}`,
    type: "general-purpose",
    description: d,
    activity: CYCLE[(Math.floor(elapsed / 4) + i * 2) % CYCLE.length]!.activity,
    currentTool: null,
    startedAt: now - 120_000,
    updatedAt: now,
  }));
  // The third subagent finishes and restarts, to show the pop in and out.
  const liveSubs = Math.floor(elapsed / 12) % 2 === 0 ? subs : subs.slice(0, 2);

  const agents = [
    agent(0, "atlas", "storefront", step.activity, { currentTool: stepTool, title: "Safe payment retries" }),
    agent(1, "birch", "storefront", "waiting", {
      title: "Dependency upgrade",
      currentTool: tool("Bash", "rm -rf node_modules && bun install", now - 30_000),
      needsYou: { reason: "permission", message: "Claude needs your permission to use Bash", since: now - 30_000, exact: true },
    }),
    agent(2, "cedar", "storefront", "delegating", { title: "Pre-release audit", subagents: liveSubs }),
    agent(3, "delta", "api-server", "web", { currentTool: tool("WebFetch", "docs.stripe.com", now - 3000) }),
    agent(4, "ember", "api-server", "done", { idleSince: now - 40_000, title: "Rate limiter rewrite" }),
    agent(5, "fjord", "api-server", "idle", { idleSince: now - 600_000 }),
    agent(6, "grove", "api-server", "sleeping", { idleSince: now - 3_600_000 }),
    agent(7, "haze", "docs", "terminal", {
      currentTool: tool("Bash", "Build the docs site", now - 4000),
      lastError: started + Math.floor(elapsed / 9) * 9000,
    }),
    agent(8, "iris", "docs", "waiting", {
      currentTool: tool("AskUserQuestion", "asking you a question", now - 50_000),
      needsYou: { reason: "question", message: "Asked you a question", since: now - 50_000, exact: true },
    }),
    // juno alternates between a break and work, to show the walk there and the hurry back.
    agent(9, "juno", "mobile-app", Math.floor(elapsed / 25) % 2 === 1 ? "idle" : "thinking", { idleSince: now - 400_000 }),
    agent(10, "kite", "mobile-app", "idle", { idleSince: now - 900_000 }),
    // lark naps, goes home through the door, then comes back in to work.
    agent(11, "lark", "mobile-app", larkPhase < 15 ? "sleeping" : larkPhase < 50 ? "away" : "thinking", {
      idleSince: now - 7_300_000,
    }),
    agent(13, "nova", "docs", "away", { idleSince: now - 20_000_000, title: "Changelog cleanup" }),
    agent(12, "moss", "mobile-app", "thinking"),
  ];

  return { at: now, hooksInstalled: true, canSend: true, agents };
}
