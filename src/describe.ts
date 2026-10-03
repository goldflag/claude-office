import type { Activity, AgentSnapshot, ToolCall } from "../shared/types.ts";

export type Group = "needs" | "working" | "done" | "idle" | "asleep" | "away";

export const GROUP_LABEL: Record<Group, string> = {
  needs: "Needs you",
  working: "Working",
  done: "Just finished",
  idle: "On a break",
  asleep: "Asleep",
  away: "Gone home",
};

export const GROUP_ORDER: Group[] = ["needs", "working", "done", "idle", "asleep", "away"];

export function groupOf(activity: Activity): Group {
  if (activity === "waiting") return "needs";
  if (activity === "done") return "done";
  if (activity === "idle") return "idle";
  if (activity === "sleeping") return "asleep";
  if (activity === "away") return "away";
  return "working";
}

/** What the agent is doing, as one short line. */
export function describeWork(activity: Activity, tool: ToolCall | null, subagents = 0): string {
  const target = tool?.summary ?? "";
  switch (activity) {
    case "writing":
      return target ? `Editing ${target}` : "Editing";
    case "terminal":
      return target || "Running a command";
    case "reading":
      return target ? `Reading ${target}` : "Reading";
    case "web":
      return target ? `On the web: ${target}` : "On the web";
    case "delegating":
      return subagents > 0 ? `Running ${subagents} subagent${subagents === 1 ? "" : "s"}` : target || "Delegating";
    case "tool":
      return target || (tool ? tool.name.replace(/^mcp__(.+?)__/, "$1: ") : "Using a tool");
    case "thinking":
      return "Thinking";
    case "waiting":
      return "Needs you";
    case "done":
      return "Finished";
    case "idle":
      return "On a break";
    case "sleeping":
      return "Asleep";
    case "away":
      return "Gone home";
  }
}

export function describeAgent(agent: AgentSnapshot): string {
  if (agent.needsYou) {
    if (agent.needsYou.reason === "question") return "Asked you a question";
    if (agent.needsYou.reason === "plan") return "Plan ready for review";
    return agent.currentTool
      ? `Wants permission: ${agent.currentTool.name}${agent.currentTool.summary ? ` ${agent.currentTool.summary}` : ""}`
      : "Wants permission";
  }
  return describeWork(agent.activity, agent.currentTool, agent.subagents.length);
}

/** Orca's default worktree names are slugs like "master" or "grouper"; real titles read like a phrase. */
const SLUG = /^[a-z0-9._\/-]+$/;

/**
 * What the session is working on: the Orca worktree's title when someone gave
 * it one, else Claude Code's own session title, else the last prompt.
 */
export function taskOf(agent: AgentSnapshot): string | null {
  const orca = agent.orca?.worktreeName?.trim();
  if (orca && !SLUG.test(orca)) return orca;
  if (agent.title) return agent.title;
  const prompt = agent.lastPrompt?.trim().replace(/\s+/g, " ");
  if (!prompt) return null;
  return prompt.length > 90 ? `${prompt.slice(0, 89)}…` : prompt;
}

export function ago(from: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
