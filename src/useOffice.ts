import { useEffect, useState } from "react";
import type { OfficeSnapshot, ServerMessage } from "../shared/types.ts";
import { demoSnapshot } from "./demo.ts";

export interface OfficeFeed {
  snapshot: OfficeSnapshot | null;
  connected: boolean;
}

const isDemo = new URLSearchParams(location.search).has("demo");

/** Live office state from the local server, reconnecting when the socket drops. */
export function useOffice(): OfficeFeed {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [connected, setConnected] = useState(isDemo);

  useEffect(() => {
    if (isDemo) {
      const tick = () => setSnapshot(demoSnapshot());
      tick();
      const id = setInterval(tick, 500);
      return () => clearInterval(id);
    }

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === "snapshot") setSnapshot(msg.data);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return { snapshot, connected };
}
