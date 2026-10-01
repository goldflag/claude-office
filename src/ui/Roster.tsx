import { useState } from "react";
import type { AgentSnapshot } from "../../shared/types.ts";
import { ago, describeAgent, type Group, GROUP_LABEL, GROUP_ORDER, groupOf } from "../describe.ts";
import { useNow } from "./useNow.ts";

interface Props {
  agents: AgentSnapshot[];
  loaded: boolean;
  hooksInstalled: boolean;
  selected: string | null;
  projectColors: Map<string, string>;
  onSelect(id: string): void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function headline(counts: Record<Group, number>, total: number): string {
  if (total === 0) return "Nobody is in yet";
  if (counts.needs > 0) return plural(counts.needs, "agent needs you", "agents need you");
  if (counts.working > 0) return plural(counts.working, "agent is working", "agents are working");
  return counts.away === total ? "Everyone has gone home" : "All quiet";
}

function since(agent: AgentSnapshot): number {
  if (agent.needsYou) return agent.needsYou.since;
  if (agent.idleSince) return agent.idleSince;
  return agent.currentTool?.startedAt ?? agent.lastActivityAt;
}

/** The staff board: every agent, grouped by how much it needs your attention. */
export function Roster({ agents, loaded, hooksInstalled, selected, projectColors, onSelect }: Props) {
  const now = useNow(1000);
  const [expanded, setExpanded] = useState<Set<Group>>(new Set());

  const groups = new Map<Group, AgentSnapshot[]>();
  for (const agent of agents) {
    const group = groupOf(agent.activity);
    groups.set(group, [...(groups.get(group) ?? []), agent]);
  }
  const counts = Object.fromEntries(GROUP_ORDER.map((g) => [g, groups.get(g)?.length ?? 0])) as Record<Group, number>;
  const rest = [
    counts.needs > 0 && counts.working > 0 ? `${counts.working} working` : "",
    counts.done > 0 ? `${counts.done} just finished` : "",
    counts.idle > 0 ? `${counts.idle} on a break` : "",
    counts.asleep > 0 ? `${counts.asleep} asleep` : "",
    counts.away > 0 ? `${counts.away} gone home` : "",
  ].filter(Boolean);

  return (
    <aside className="board" aria-label="Agents">
      <header className="board-head">
        <p className="board-title">Claude Office</p>
        <h1 className={counts.needs > 0 ? "headline headline-needs" : "headline"}>
          {loaded ? headline(counts, agents.length) : "Opening the office"}
        </h1>
        {rest.length > 0 && <p className="board-sub">{rest.join(", ")}</p>}
      </header>

      {loaded && agents.length === 0 && (
        <p className="board-empty">
          No Claude Code sessions are running. Start one in any terminal and its Clawd will take a desk here.
        </p>
      )}

      {GROUP_ORDER.map((group) => {
        const members = groups.get(group);
        if (!members?.length) return null;
        const collapsible = group === "asleep" || group === "away";
        const collapsed = collapsible && !expanded.has(group) && !members.some((m) => m.id === selected);
        return (
          <section key={group} className="group" data-group={group}>
            {collapsible ? (
              <button
                className="group-toggle"
                aria-expanded={!collapsed}
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (collapsed) next.add(group);
                    else next.delete(group);
                    return next;
                  })
                }
              >
                <span>
                  {GROUP_LABEL[group]} <span className="group-count">{members.length}</span>
                </span>
                <span className="group-chevron" aria-hidden="true" />
              </button>
            ) : (
              <h2 className="group-title">
                {GROUP_LABEL[group]} <span className="group-count">{members.length}</span>
              </h2>
            )}
            {!collapsed && (
              <ul className="rows">
                {members.map((agent) => (
                  <li key={agent.id}>
                    <button className="row" aria-current={agent.id === selected} onClick={() => onSelect(agent.id)}>
                      <span className="magnet" aria-hidden="true" />
                      <span className="row-main">
                        <span className="row-top">
                          <span className="row-name">{agent.name}</span>
                          <span className="chip" style={{ background: projectColors.get(agent.project) }}>
                            {agent.project}
                          </span>
                        </span>
                        <span className="row-status">
                          {group === "asleep" || group === "idle" || group === "away"
                            ? (agent.title ?? "No task yet")
                            : describeAgent(agent)}
                        </span>
                      </span>
                      <span className="row-time">{ago(since(agent), now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {loaded && !hooksInstalled && agents.length > 0 && (
        <p className="board-foot">
          Permission prompts are estimated from session files. For exact ones, run <code>bun run hooks:install</code>.
        </p>
      )}
    </aside>
  );
}
