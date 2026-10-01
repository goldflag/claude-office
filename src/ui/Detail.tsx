import type { AgentSnapshot } from "../../shared/types.ts";
import { ago, describeAgent, describeWork, groupOf, tokens } from "../describe.ts";
import { useNow } from "./useNow.ts";

interface Props {
  agent: AgentSnapshot;
  color: string;
  onClose(): void;
}

const shortPath = (cwd: string) => cwd.replace(/^\/Users\/[^/]+/, "~");

/** Everything known about one agent: what it was asked, what it is doing, what it did. */
export function Detail({ agent, color, onClose }: Props) {
  const now = useNow(1000);
  const group = groupOf(agent.activity);
  const recent = agent.recent.slice().reverse();

  return (
    <aside className="detail" data-group={group} aria-label={`Details for ${agent.name}`}>
      <header className="detail-head">
        <div>
          <h2 className="detail-name">{agent.name}</h2>
          <p className="detail-status">
            <span className="magnet" aria-hidden="true" />
            {describeAgent(agent)}
          </p>
        </div>
        <button className="close" onClick={onClose} aria-label="Close details">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {agent.needsYou && (
        <p className="callout">
          {agent.needsYou.message}
          {!agent.needsYou.exact && " This is a guess from the session files, so check the terminal."}
        </p>
      )}

      <p className="detail-where">
        <span className="chip" style={{ background: color }}>
          {agent.project}
        </span>
        {agent.branch && <span className="branch">{agent.branch}</span>}
      </p>

      {agent.title && <p className="detail-title">{agent.title}</p>}

      {agent.lastPrompt && (
        <section>
          <h3>You asked</h3>
          <blockquote>{agent.lastPrompt}</blockquote>
        </section>
      )}

      {agent.subagents.length > 0 && (
        <section>
          <h3>Subagents</h3>
          <ul className="subs">
            {agent.subagents.map((sub) => (
              <li key={sub.id}>
                <span className="sub-name">{sub.description || sub.type}</span>
                <span className="sub-doing">{describeWork(sub.activity, sub.currentTool)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h3>Recent activity</h3>
          <ol className="log">
            {recent.map((entry, i) => (
              <li key={`${entry.at}-${i}`} data-kind={entry.kind}>
                <span className="log-time">{ago(entry.at, now)}</span>
                <span className="log-body">
                  <span className="log-label">{entry.label}</span> {entry.detail}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <dl className="facts">
        <div>
          <dt>Context</dt>
          <dd>{tokens(agent.contextTokens)} tokens</dd>
        </div>
        <div>
          <dt>Session age</dt>
          <dd>{ago(agent.startedAt, now)}</dd>
        </div>
        {agent.model && (
          <div>
            <dt>Model</dt>
            <dd>{agent.model.replace(/^claude-/, "")}</dd>
          </div>
        )}
        <div>
          <dt>Folder</dt>
          <dd title={agent.cwd}>{shortPath(agent.cwd)}</dd>
        </div>
      </dl>
    </aside>
  );
}
