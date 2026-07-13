import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Archive, Hash, Lock, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { toast } from "sonner";

import { ApiRequestError, archiveChannel } from "@/lib/api";
import {
  channelQuery,
  memberLabel,
  membersQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

const handleTabKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }

  const tabList =
    event.currentTarget.parentElement?.querySelectorAll<HTMLAnchorElement>(
      "a[data-channel-tab]"
    );
  const tabs = [...tabList ?? []];
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex === -1) {
    return;
  }

  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const nextTab = tabs.at(
    (currentIndex + direction + tabs.length) % tabs.length
  );
  if (!nextTab) {
    return;
  }

  for (const tab of tabs) {
    tab.tabIndex = tab === nextTab ? 0 : -1;
  }
  nextTab.focus();
};

const ChannelLayout = () => {
  const { channelId, workspaceId } = Route.useParams();
  const channel = useQuery(channelQuery(workspaceId, channelId));
  const members = useQuery(membersQuery(workspaceId));
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const archive = useMutation({
    mutationFn: () => archiveChannel(workspaceId, channelId),
    onError: (error) =>
      toast.error(
        `Could not archive channel: ${error instanceof ApiRequestError ? error.kind : "unknown_error"}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.graph(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.channel(workspaceId, channelId),
      });
      setConfirming(false);
      toast.success("Channel archived");
    },
  });

  if (channel.isPending) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (channel.isError || !channel.data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8 text-sm text-muted-foreground">
        <TriangleAlert className="mr-2 inline size-4" />
        Channel unavailable
      </div>
    );
  }
  const archived = channel.data.lifecycle.state !== "active";
  const Glyph = channel.data.visibility.kind === "private" ? Lock : Hash;
  const tabs = [
    { label: "Threads", to: "/w/$workspaceId/channels/$channelId" as const },
    {
      label: "Artifacts",
      to: "/w/$workspaceId/channels/$channelId/artifacts" as const,
    },
    {
      label: "Shape",
      to: "/w/$workspaceId/channels/$channelId/shape" as const,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-6 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <Glyph className="mt-1 size-5 text-muted-foreground" />
            <h1 className="font-semibold text-xl tracking-tight">
              {channel.data.goal}
            </h1>
          </div>
          {!archived &&
            (confirming ? (
              <div className="flex gap-2">
                <Button
                  disabled={archive.isPending}
                  onClick={() => archive.mutate()}
                  size="sm"
                  variant="destructive"
                >
                  Confirm archive
                </Button>
                <Button
                  onClick={() => setConfirming(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirming(true)}
                size="sm"
                variant="ghost"
              >
                <Archive className="size-4" />
                Archive
              </Button>
            ))}
        </div>
        <div className="flex gap-2 pl-7 text-xs text-muted-foreground">
          <span>{channel.data.visibility.kind}</span>
          <span>·</span>
          <span>{archived ? "archived" : "active"}</span>
          <span>·</span>
          <span>
            owner {memberLabel(members.data, channel.data.ownerMemberId)}
          </span>
        </div>
      </header>
      <nav aria-label="Channel" className="mt-5 flex gap-1 border-b pb-2">
        {tabs.map((tab) => (
          <Link
            activeOptions={{ exact: true }}
            activeProps={{
              "aria-current": "page",
              className: "text-primary",
              tabIndex: 0,
            }}
            className="rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-channel-tab
            inactiveProps={{ tabIndex: -1 }}
            key={tab.label}
            onKeyDown={handleTabKeyDown}
            params={{ channelId, workspaceId }}
            to={tab.to}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="pt-6">
        <Outlet />
      </div>
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId/channels/$channelId")({
  component: ChannelLayout,
});
