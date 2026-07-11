import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@thinkspace/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Input } from "@thinkspace/ui/components/input";
import { Label } from "@thinkspace/ui/components/label";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { CheckCircle2, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ApiRequestError,
  approveHost,
  deleteMcpServer,
  registerMcpServer,
  revokeHost,
} from "@/lib/api";
import type { WorkspaceMcpHost, WorkspaceMcpServer } from "@/lib/api";
import {
  mcpHostsQuery,
  mcpServersQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/**
 * E11.3 MCP servers settings (ADR 0002 egress allowlist). The web half of the registry that E8.2
 * shipped API-only. Two coupled surfaces: the registered servers, and the egress-host allowlist a
 * server must sit on to connect. The coupling is the teaching point — registration gates the host
 * BEFORE anything persists, so an unapproved host is a 403 `mcp_host_not_allowed` and nothing
 * lands; the page then points the owner at host approval. Server register/delete is owner/admin;
 * growing or shrinking the allowlist is owner-ONLY (the acting owner is recorded on the approval
 * row). Owner-only controls render for everyone and 403 with a teaching toast for non-owners
 * (show-then-403, consistent with the provider-key surface).
 */

const errorKind = (error: unknown): string =>
  error instanceof ApiRequestError ? error.kind : "unknown_error";

const McpServerRow = ({
  server,
  hostApproved,
  workspaceId,
}: {
  readonly server: WorkspaceMcpServer;
  readonly hostApproved: boolean;
  readonly workspaceId: string;
}) => {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => deleteMcpServer(workspaceId, server.id),
    onError: (error) => {
      const kind = errorKind(error);
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner or admin can remove an MCP server."
          : `Could not remove server: ${kind}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.mcpServers(workspaceId),
      });
      toast.success(`${server.name} removed`);
    },
  });

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-foreground text-sm">
          {server.name}
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {server.host}
        </span>
        {hostApproved ? (
          <span className="flex items-center gap-1.5 text-success text-xs">
            <CheckCircle2 aria-hidden="true" className="size-3.5" />
            Host approved — this server can connect.
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-destructive text-xs">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            Host not approved — this server cannot connect until it is.
          </span>
        )}
      </div>
      <Button
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
        size="sm"
        type="button"
        variant="outline"
      >
        {remove.isPending ? "Removing…" : "Remove"}
      </Button>
    </div>
  );
};

const RegisterServerForm = ({
  workspaceId,
}: {
  readonly workspaceId: string;
}) => {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [url, setUrl] = useState("");
  const queryClient = useQueryClient();

  const register = useMutation({
    mutationFn: () =>
      registerMcpServer(workspaceId, {
        host: host.trim(),
        name: name.trim(),
        url: url.trim(),
      }),
    onError: (error) => {
      const kind = errorKind(error);
      if (kind === "mcp_host_not_allowed") {
        toast.error(
          "That host is not approved yet. Approve it under Approved hosts first — a server can only register on a host that is already on the allowlist."
        );
        return;
      }
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner or admin can register an MCP server."
          : `Could not register server: ${kind}`
      );
    },
    onSuccess: () => {
      setName("");
      setHost("");
      setUrl("");
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.mcpServers(workspaceId),
      });
      toast.success(`${name.trim()} registered`);
    },
  });

  const canSubmit =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    url.trim().length > 0 &&
    !register.isPending;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          register.mutate();
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-server-name">Name</Label>
        <Input
          id="mcp-server-name"
          onChange={(event) => setName(event.target.value)}
          placeholder="Docs"
          value={name}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-server-host">Host</Label>
        <Input
          autoComplete="off"
          id="mcp-server-host"
          onChange={(event) => setHost(event.target.value)}
          placeholder="mcp.example.com"
          spellCheck={false}
          value={host}
        />
        <p className="text-muted-foreground text-xs">
          Must already be on the approved-hosts allowlist below, or registration
          is rejected and nothing is saved.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-server-url">URL</Label>
        <Input
          autoComplete="off"
          id="mcp-server-url"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          spellCheck={false}
          value={url}
        />
      </div>
      <div className="flex justify-end">
        <Button disabled={!canSubmit} size="sm" type="submit">
          {register.isPending ? "Registering…" : "Register server"}
        </Button>
      </div>
    </form>
  );
};

const McpServersPanel = ({
  servers,
  approvedHosts,
  workspaceId,
}: {
  readonly servers: UseQueryResult<readonly WorkspaceMcpServer[]>;
  readonly approvedHosts: ReadonlySet<string>;
  readonly workspaceId: string;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Server aria-hidden="true" className="size-4 opacity-80" />
        Registered servers
      </CardTitle>
      <CardDescription>
        The MCP servers this workspace can select into a channel shape. A server
        connects only while its host stays on the approved-hosts allowlist.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {servers.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : servers.isError ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Could not load servers</EmptyTitle>
            <EmptyDescription>
              This is usually transient — try again in a moment (
              {errorKind(servers.error)}).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (servers.data?.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-border border-dashed bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
          No servers registered yet. Approve a host below, then register a
          server on it.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {(servers.data ?? []).map((server) => (
            <McpServerRow
              hostApproved={approvedHosts.has(server.host)}
              key={server.id}
              server={server}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}
      <RegisterServerForm workspaceId={workspaceId} />
    </CardContent>
  </Card>
);

const ApprovedHostRow = ({
  host,
  workspaceId,
}: {
  readonly host: WorkspaceMcpHost;
  readonly workspaceId: string;
}) => {
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: () => revokeHost(workspaceId, host.host),
    onError: (error) => {
      const kind = errorKind(error);
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner can revoke an egress host."
          : `Could not revoke host: ${kind}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.mcpHosts(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.mcpServers(workspaceId),
      });
      toast.success(`${host.host} revoked`);
    },
  });

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
      <span className="flex items-center gap-2 truncate text-foreground text-sm">
        <ShieldCheck aria-hidden="true" className="size-4 text-success" />
        {host.host}
      </span>
      <Button
        disabled={revoke.isPending}
        onClick={() => revoke.mutate()}
        size="sm"
        type="button"
        variant="outline"
      >
        {revoke.isPending ? "Revoking…" : "Revoke"}
      </Button>
    </div>
  );
};

const ApproveHostForm = ({ workspaceId }: { readonly workspaceId: string }) => {
  const [host, setHost] = useState("");
  const queryClient = useQueryClient();

  const approve = useMutation({
    mutationFn: () => approveHost(workspaceId, host.trim()),
    onError: (error) => {
      const kind = errorKind(error);
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner can approve an egress host."
          : `Could not approve host: ${kind}`
      );
    },
    onSuccess: () => {
      setHost("");
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.mcpHosts(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.mcpServers(workspaceId),
      });
      toast.success(`${host.trim()} approved`);
    },
  });

  const canSubmit = host.trim().length > 0 && !approve.isPending;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          approve.mutate();
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-approve-host">Host</Label>
        <Input
          autoComplete="off"
          id="mcp-approve-host"
          onChange={(event) => setHost(event.target.value)}
          placeholder="mcp.example.com"
          spellCheck={false}
          value={host}
        />
        <p className="text-muted-foreground text-xs">
          Approving a host is the deliberate, auditable owner action that admits
          it to the egress allowlist (ADR 0002).
        </p>
      </div>
      <div className="flex justify-end">
        <Button disabled={!canSubmit} size="sm" type="submit">
          {approve.isPending ? "Approving…" : "Approve host"}
        </Button>
      </div>
    </form>
  );
};

const ApprovedHostsPanel = ({
  hosts,
  workspaceId,
}: {
  readonly hosts: UseQueryResult<readonly WorkspaceMcpHost[]>;
  readonly workspaceId: string;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-4 opacity-80" />
        Approved hosts
      </CardTitle>
      <CardDescription>
        The egress allowlist (ADR 0002). A server can register and connect only
        while its host is on this list. Approve and revoke are owner-only.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {hosts.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : hosts.isError ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Could not load approved hosts</EmptyTitle>
            <EmptyDescription>
              This is usually transient — try again in a moment (
              {errorKind(hosts.error)}).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (hosts.data?.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-border border-dashed bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
          No hosts approved yet. An owner approves a host before any server can
          register on it.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {(hosts.data ?? []).map((host) => (
            <ApprovedHostRow
              host={host}
              key={host.host}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}
      <ApproveHostForm workspaceId={workspaceId} />
    </CardContent>
  </Card>
);

const McpSettings = () => {
  const { workspaceId } = useParams({
    from: "/w/$workspaceId/settings/mcp",
  });
  const servers = useQuery(mcpServersQuery(workspaceId));
  const hosts = useQuery(mcpHostsQuery(workspaceId));

  const approvedHosts = new Set((hosts.data ?? []).map((host) => host.host));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          MCP servers
        </h1>
        <p className="text-muted-foreground text-sm">
          Register the MCP servers a channel shape can select, and manage the
          egress allowlist their hosts must sit on. A server connects only while
          its host is approved — approving a host is an owner-only action.
        </p>
      </header>

      <McpServersPanel
        approvedHosts={approvedHosts}
        servers={servers}
        workspaceId={workspaceId}
      />
      <ApprovedHostsPanel hosts={hosts} workspaceId={workspaceId} />
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId/settings/mcp")({
  component: McpSettings,
  ssr: false,
});
