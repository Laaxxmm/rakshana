"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

export default function LoginForm({ next }: { next?: string }) {
  const [state, action, isPending] = useActionState<LoginState | null, FormData>(
    loginAction,
    null,
  );
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next ?? ""} />

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.in"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/8 px-3 py-2 text-sm text-[color:var(--danger)]"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
