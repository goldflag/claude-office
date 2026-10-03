import { useEffect, useState } from "react";
import { readTerminal } from "../api.ts";

const RULE = /^[\s─━═-]{12,}$/;

/** Trims the screen to what fits a narrow panel: no blank tail, short divider lines. */
function tidy(lines: string[]): string {
  const out = lines.map((line) => (RULE.test(line) && line.trim() ? "─".repeat(36) : line));
  while (out.length > 0 && !out[out.length - 1]!.trim()) out.pop();
  return out.slice(-28).join("\n");
}

/** A live look at the agent's terminal screen, refreshed while it is open. */
export function TerminalPeek({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () =>
      readTerminal(agentId)
        .then((view) => {
          if (cancelled) return;
          setScreen(tidy(view.lines));
          setError(null);
        })
        .catch((err: Error) => !cancelled && setError(err.message));
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, agentId]);

  return (
    <section>
      <button className="disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>Terminal</span>
        <span className="group-chevron" aria-hidden="true" />
      </button>
      {open && error && <p className="composer-status" data-kind="error">{error}</p>}
      {open && !error && <pre className="terminal">{screen ?? "Reading the terminal"}</pre>}
    </section>
  );
}
