import { env } from "@thinkspace/env/web";
import { useEffect, useRef, useState } from "react";

import { fetchHubToken } from "./api";

/**
 * The channel hub delta stream (ADR 0010/0028, baked decision 5). The client fetches a
 * short-lived JWT from GET /token, then opens a WebSocket to the channel hub with the token in
 * a `?token=` query param (the browser cannot set request headers on a WS handshake; the param
 * name is pinned by the hub's `readHubConnectToken`). The hub verifies the token itself and
 * closes an unauthorized socket with 4401 — the client never learns which check tripped.
 *
 * Events are `ChannelHubEvent` JSON. The hub speaks *only* its own event JSON (its DO sets
 * `sendIdentityOnConnect: false`), but the agents-SDK client protocol still emits `cf_agent_*`
 * control frames the app must ignore. Events carry ids, not state (the seam is a delta bus),
 * so the consumer reconciles by refetching the branch — the socket is a "something changed"
 * nudge, and its absence is survivable (the caller falls back to polling).
 */

export type ChannelHubEvent =
  | {
      readonly commentId: string;
      readonly kind: "comment_added";
      readonly threadId: string;
    }
  | {
      readonly kind: "run_lifecycle_changed";
      readonly runId: string;
      readonly threadId: string;
    };

export type HubStatus = "connecting" | "open" | "closed";

/** WS close code the hub uses to reject an upgrade (mirrors HUB_UPGRADE_REJECT_CODE). */
const HUB_REJECT_CODE = 4401;
const RECONNECT_MS = 3000;

const wsOrigin = (): string =>
  env.VITE_SERVER_URL.replace(/^http/u, "ws").replace(/\/$/u, "");

const isHubEvent = (data: unknown): data is ChannelHubEvent => {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const kind = (data as { kind?: unknown }).kind;
  return kind === "comment_added" || kind === "run_lifecycle_changed";
};

/**
 * Subscribe to a channel hub for as long as the component is mounted and `enabled`. `onEvent`
 * is read through a ref so a changing callback never tears the socket down. Returns the live
 * connection status so the surface can show a "reconnecting" affordance and lean on polling.
 */
export const useChannelHub = (input: {
  readonly channelId: string;
  readonly enabled?: boolean;
  readonly onEvent: (event: ChannelHubEvent) => void;
  readonly workspaceId: string;
}): HubStatus => {
  const { channelId, enabled = true, onEvent, workspaceId } = input;
  const [status, setStatus] = useState<HubStatus>("closed");

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      if (disposed) {
        return;
      }
      setStatus("closed");
      reconnectTimer = setTimeout(connect, RECONNECT_MS);
    };

    const connect = async () => {
      if (disposed) {
        return;
      }
      setStatus("connecting");
      let token: string;
      try {
        token = (await fetchHubToken(workspaceId)).token;
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed) {
        return;
      }

      const url = `${wsOrigin()}/api/w/${encodeURIComponent(
        workspaceId
      )}/channels/${encodeURIComponent(channelId)}/ws?token=${encodeURIComponent(
        token
      )}`;
      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        if (!disposed) {
          setStatus("open");
        }
      });
      socket.addEventListener("message", (message) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (isHubEvent(parsed)) {
          onEventRef.current(parsed);
        }
      });
      socket.addEventListener("close", (event) => {
        // 4401 means the token was rejected (expired/wrong) — a reconnect refetches a fresh one.
        if (event.code === HUB_REJECT_CODE) {
          scheduleReconnect();
          return;
        }
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        socket?.close();
      });
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [channelId, enabled, workspaceId]);

  return status;
};
