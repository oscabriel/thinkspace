import { createFileRoute, getRouteApi } from "@tanstack/react-router";

const routeApi = getRouteApi("/_auth/dashboard");

const RouteComponent = () => {
  const { session } = routeApi.useRouteContext();

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.data?.user.name}</p>
    </div>
  );
};

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});
