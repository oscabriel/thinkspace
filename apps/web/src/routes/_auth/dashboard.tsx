import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

const routeApi = getRouteApi("/_auth/dashboard");

const RouteComponent = () => {
  const { session } = routeApi.useRouteContext();

  const privateData = useQuery(orpc.privateData.queryOptions());

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.data?.user.name}</p>
      <p>API: {privateData.data?.message}</p>
    </div>
  );
};

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});
