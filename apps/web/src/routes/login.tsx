import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

const RouteComponent = () => {
  const [showSignIn, setShowSignIn] = useState(false);
  const { redirect } = Route.useSearch();

  return showSignIn ? (
    <SignInForm
      onSwitchToSignUp={() => setShowSignIn(false)}
      redirectTo={redirect}
    />
  ) : (
    <SignUpForm
      onSwitchToSignIn={() => setShowSignIn(true)}
      redirectTo={redirect}
    />
  );
};

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  // Same-origin paths only: "/…" but not "//" or "/\" (protocol-relative,
  // which window.location.assign would treat as an external open redirect).
  validateSearch: z.object({
    redirect: z
      .string()
      .regex(/^\/(?![/\\])/)
      .optional(),
  }),
});
