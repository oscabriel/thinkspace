import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  RunCard,
  RunCardActions,
  RunCardBody,
  RunCardBodySkeleton,
  RunCardCodeChip,
  RunCardHeader,
  RunCardMeta,
  RunCardSection,
  RunCardStatus,
  RunCardTitle,
} from "@thinkspace/ui/components/run-card";
import { Moon, Sun } from "lucide-react";

/** Dev-only design gallery for the run card (DESIGN.md §5 signature component). */

const CompleteCard = () => (
  <RunCard status="complete">
    <RunCardHeader>
      <RunCardTitle>
        Dispatch: compare Secrets Store naming constraints across providers
      </RunCardTitle>
      <RunCardStatus status="complete" />
    </RunCardHeader>
    <RunCardBody>
      <p>
        Verified the alias format against live Cloudflare docs. Store names
        allow <RunCardCodeChip>[a-zA-Z0-9_-]</RunCardCodeChip> up to 64 chars,
        so{" "}
        <RunCardCodeChip>
          ws-&lt;workspaceId&gt;-&lt;provider&gt;
        </RunCardCodeChip>{" "}
        fits with room to spare. The gateway resolves one alias per
        workspace-provider pair, which matches the registry design.
      </p>
    </RunCardBody>
    <RunCardSection label="Caveats">
      <li>
        Alias renames are not supported upstream — deleting and re-creating is
        the only rotation path.
      </li>
      <li>Docs verified today; the constraint table is marked beta.</li>
    </RunCardSection>
    <RunCardSection label="To do">
      <li>Freeze the format in ADR 0036 and add the redaction test.</li>
    </RunCardSection>
    <RunCardActions>
      <Button>Approve</Button>
      <Button variant="secondary">Request changes</Button>
      <Button
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        Reject
      </Button>
    </RunCardActions>
    <RunCardMeta>
      <span data-agent>research-channel agent</span>
      <span aria-hidden="true">·</span>
      <RunCardCodeChip>anthropic/claude-sonnet-5</RunCardCodeChip>
      <span aria-hidden="true">·</span>
      <span>2m 14s</span>
    </RunCardMeta>
  </RunCard>
);

const RunningCard = () => (
  <RunCard status="running">
    <RunCardHeader>
      <RunCardTitle>
        Dispatch: verify fetchMock interception inside Durable Objects
      </RunCardTitle>
      <RunCardStatus status="running" />
    </RunCardHeader>
    <RunCardBodySkeleton />
    <RunCardMeta>
      <span data-agent>research-channel agent</span>
      <span aria-hidden="true">·</span>
      <RunCardCodeChip>anthropic/claude-sonnet-5</RunCardCodeChip>
    </RunCardMeta>
  </RunCard>
);

const QueuedCard = () => (
  <RunCard status="queued">
    <RunCardHeader>
      <RunCardTitle>Scheduled: weekly backlog drift summary</RunCardTitle>
      <RunCardStatus status="queued" />
    </RunCardHeader>
    <RunCardMeta>
      <span data-agent>planning-channel agent</span>
      <span aria-hidden="true">·</span>
      <span>fires in 12m</span>
    </RunCardMeta>
  </RunCard>
);

const FailedCard = () => (
  <RunCard status="failed">
    <RunCardHeader>
      <RunCardTitle>
        Dispatch: summarize the models.dev catalog schema
      </RunCardTitle>
      <RunCardStatus status="failed" />
    </RunCardHeader>
    <RunCardBody>
      <p className="text-muted-foreground">
        The provider rejected the request: no key is registered for{" "}
        <RunCardCodeChip>anthropic</RunCardCodeChip> in this workspace. Register
        a provider key, then retry.
      </p>
    </RunCardBody>
    <RunCardActions>
      <Button variant="secondary">Retry dispatch</Button>
    </RunCardActions>
    <RunCardMeta>
      <span data-agent>research-channel agent</span>
      <span aria-hidden="true">·</span>
      <span>failed after 3s</span>
    </RunCardMeta>
  </RunCard>
);

const toggleTheme = () => {
  document.documentElement.classList.toggle("dark");
};

const RunCardGallery = () => (
  <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 overflow-y-auto px-4 py-10">
    <header className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl leading-tight font-semibold tracking-[-0.01em]">
          Run card
        </h1>
        <p className="text-sm text-muted-foreground">
          Signature component states — agents propose, people decide.
        </p>
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={toggleTheme}
        aria-label="Toggle theme"
      >
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
      </Button>
    </header>
    {(
      [
        ["Complete", <CompleteCard key="c" />],
        ["Running", <RunningCard key="r" />],
        ["Queued", <QueuedCard key="q" />],
        ["Failed", <FailedCard key="f" />],
      ] as const
    ).map(([label, card]) => (
      <section key={label} className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
        {card}
      </section>
    ))}
  </main>
);

export const Route = createFileRoute("/design/run-card")({
  component: RunCardGallery,
});
