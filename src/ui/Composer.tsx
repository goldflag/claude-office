import { type FormEvent, type KeyboardEvent, useState } from "react";
import type { AgentSnapshot } from "../../shared/types.ts";
import { openInOrca, sendMessage } from "../api.ts";
import { groupOf } from "../describe.ts";

interface Props {
  agent: AgentSnapshot;
  canSend: boolean;
}

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; note: string } | { kind: "error"; note: string };

/** Sends a prompt to the agent through its Orca terminal, or says why it cannot. */
export function Composer({ agent, canSend }: Props) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const open = () =>
    openInOrca(agent.id).catch((err: Error) => setPhase({ kind: "error", note: err.message }));

  if (!agent.orca) {
    return (
      <footer className="composer">
        <p className="composer-note">
          {agent.name} is running in {agent.app ?? "a terminal outside Orca"}, so the office can only watch it. Sessions
          started from Orca can be messaged here.
        </p>
      </footer>
    );
  }

  const blocked = agent.needsYou
    ? `${agent.name} is showing a prompt. A message typed now would answer it by accident.`
    : !agent.orca.writable
      ? "Orca reports this terminal is not accepting input right now."
      : !canSend
        ? "This office was started read-only."
        : null;

  if (blocked) {
    return (
      <footer className="composer">
        <p className="composer-note">{blocked}</p>
        <div className="composer-row">
          {phase.kind === "error" && <p className="composer-status" data-kind="error">{phase.note}</p>}
          <button type="button" className="send" onClick={open}>
            {agent.needsYou ? "Answer in Orca" : "Open in Orca"}
          </button>
        </div>
      </footer>
    );
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (!message || phase.kind === "sending") return;
    setPhase({ kind: "sending" });
    try {
      const { started } = await sendMessage(agent.id, message);
      setText("");
      setPhase({
        kind: "sent",
        note: started ? `Sent. ${agent.name} has started on it.` : `Sent. It is queued until ${agent.name} is free.`,
      });
    } catch (err) {
      setPhase({ kind: "error", note: (err as Error).message });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) void submit();
    // Escape belongs to the text box here, not to closing the panel.
    if (event.key === "Escape") event.stopPropagation();
  };

  const busy = groupOf(agent.activity) === "working";

  return (
    <form className="composer" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="composer-text">
        Message {agent.name}
      </label>
      <textarea
        id="composer-text"
        rows={2}
        value={text}
        placeholder={busy ? `Message ${agent.name}. It will queue behind the current step.` : `Message ${agent.name}`}
        onChange={(e) => {
          setText(e.target.value);
          if (phase.kind !== "sending") setPhase({ kind: "idle" });
        }}
        onKeyDown={onKeyDown}
        disabled={phase.kind === "sending"}
      />
      <div className="composer-row">
        {(phase.kind === "sent" || phase.kind === "error") && (
          <p className="composer-status" data-kind={phase.kind} role="status">
            {phase.note}
          </p>
        )}
        <button type="button" className="quiet-button" onClick={open}>
          Open in Orca
        </button>
        <button type="submit" className="send" disabled={!text.trim() || phase.kind === "sending"}>
          {phase.kind === "sending" ? "Sending" : "Send"}
        </button>
      </div>
    </form>
  );
}
