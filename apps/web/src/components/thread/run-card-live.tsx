import {
  RunCard,
  RunCardBody,
  RunCardBodySkeleton,
  RunCardHeader,
  RunCardMeta,
  RunCardStatus,
  RunCardTitle,
} from "@thinkspace/ui/components/run-card";
import type { RunStatus } from "@thinkspace/ui/components/run-card";

/**
 * A live run rendered with the run-card design primitives (DESIGN §5). Run state is DO-resident
 * and not read back over HTTP in the MVP (ADR 0028: no D1 run index), and the hub deltas carry
 * ids without state — so the card's status is what the client can *observe*: it opens "running"
 * from the dispatch receipt and settles when the run's output comment lands in the branch
 * (surfaced by `comment_added` → branch refetch, or the branch poll when the socket is down).
 * A never-settling run flips to "failed" on a client-side timeout — a card is never a spinner
 * in a void.
 */
export interface ActiveRun {
  readonly runId: string;
  readonly startedAt: number;
  readonly status: RunStatus;
}

const statusTitle: Record<RunStatus, string> = {
  complete: "Run complete",
  failed: "Run failed",
  queued: "Run queued",
  running: "The channel agent is working",
};

export const RunCardLive = ({ run }: { readonly run: ActiveRun }) => (
  <RunCard status={run.status}>
    <RunCardHeader>
      <RunCardTitle>{statusTitle[run.status]}</RunCardTitle>
      <RunCardStatus status={run.status} />
    </RunCardHeader>
    {run.status === "failed" ? (
      <RunCardBody>
        <p>
          The agent did not return a result. Ask again, or check the channel&apos;s
          provider key and shape.
        </p>
      </RunCardBody>
    ) : (
      <RunCardBodySkeleton />
    )}
    <RunCardMeta>
      <span data-agent>Channel agent</span>
    </RunCardMeta>
  </RunCard>
);
