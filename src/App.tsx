import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSnapshot } from "../shared/types.ts";
import { AgentTerminal } from "./ui/AgentTerminal.tsx";
import { OfficeCanvas } from "./ui/OfficeCanvas.tsx";
import { Roster } from "./ui/Roster.tsx";
import { projectColors as assignProjectColors } from "./scene/layout.ts";
import type { OfficeScene, TimeMode } from "./scene/Office.ts";
import { useOffice } from "./useOffice.ts";

const TIME_MODES: { value: TimeMode; label: string }[] = [
  { value: "auto", label: "Local time" },
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
];

/** `?light=day` or `?light=night` pins the lighting; otherwise it follows the local clock. */
function initialTimeMode(): TimeMode {
  const light = new URLSearchParams(location.search).get("light");
  return light === "day" || light === "night" ? light : "auto";
}

/**
 * `?menubar` is set by the macOS menu bar app. Its menu lists the agents, so the
 * office drops the board, and its small popover has no room for the lighting switch.
 */
const MENUBAR = new URLSearchParams(location.search).has("menubar");

declare global {
  interface Window {
    /** Lets the menu bar app open the office on an agent from a notification or its menu. */
    claudeOffice?: { select(id: string): void };
    webkit?: { messageHandlers?: { office?: { postMessage(message: string): void } } };
  }
}

export function App() {
  const { snapshot, connected } = useOffice();
  const [selected, setSelected] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<TimeMode>(initialTimeMode);
  const scene = useRef<OfficeScene | null>(null);

  const agents: AgentSnapshot[] = snapshot?.agents ?? [];
  const projectKey = [...new Set(agents.map((a) => a.project))].sort().join("|");
  const projectColors = useMemo(() => assignProjectColors(projectKey ? projectKey.split("|") : []), [projectKey]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    scene.current?.setSelected(id);
  }, []);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // In the menu bar popover, Esc with nothing selected closes the popover.
      if (selectedRef.current) {
        // Handled here, or the web view passes Esc on and the popover closes too.
        e.preventDefault();
        select(null);
      } else {
        window.webkit?.messageHandlers?.office?.postMessage("close");
      }
    };
    window.addEventListener("keydown", onKey);
    window.claudeOffice = { select };
    return () => {
      window.removeEventListener("keydown", onKey);
      delete window.claudeOffice;
    };
  }, [select]);

  const selectedAgent = agents.find((a) => a.id === selected) ?? null;

  return (
    <div className={MENUBAR ? "app menubar" : "app"}>
      <OfficeCanvas
        snapshot={snapshot}
        timeMode={timeMode}
        sceneRef={scene}
        paused={selectedAgent !== null}
        board={!MENUBAR}
        onSelect={select}
      />

      {/* While a terminal fills the view, what is behind it is out of reach of the keyboard too. */}
      <div inert={selectedAgent !== null}>
        {!MENUBAR && (
          <Roster
            agents={agents}
            loaded={snapshot !== null}
            hooksInstalled={snapshot?.hooksInstalled ?? true}
            selected={selected}
            projectColors={projectColors}
            onSelect={select}
          />
        )}

        <div className="view-controls">
          <div className="segmented" role="group" aria-label="Lighting">
            {TIME_MODES.map((m) => (
              <button key={m.value} aria-pressed={timeMode === m.value} onClick={() => setTimeMode(m.value)}>
                {m.label}
              </button>
            ))}
          </div>
          <button className="plain-button" onClick={() => scene.current?.resetView()}>
            Show whole office
          </button>
        </div>

        <p className="hint">Drag to move, right-drag to turn, scroll to zoom. Click a Clawd to open its terminal.</p>
      </div>

      {selectedAgent && (
        <AgentTerminal
          key={selectedAgent.id}
          agent={selectedAgent}
          canSend={snapshot?.canSend ?? false}
          onClose={() => select(null)}
        />
      )}

      {!connected && (
        <div className="notice" role="status">
          {MENUBAR ? (
            "Lost the connection to the office server. Restarting it."
          ) : (
            <>
              Lost the connection to the office server. Retrying. If it stays down, run <code>bun run dev</code>.
            </>
          )}
        </div>
      )}
    </div>
  );
}
