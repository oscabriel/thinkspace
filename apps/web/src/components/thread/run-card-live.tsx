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
 * (ADR 0028: no D1 run index) and the hub deltas carry ids without state — so the card opens
 * "running" from the dispatch receipt and settles from the server-authoritative run-state read
 * (`getRun`, run-card-live's owner fetches it on each `run_lifecycle_changed`): a completion
 * retires the card as its output comment lands in the branch, and an errored run — which never
 * lands an output comment — flips to "failed" the instant its lifecycle delta arrives, rather
 * than waiting out the client-side timeout that now only backstops a delta that never arrives.
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
