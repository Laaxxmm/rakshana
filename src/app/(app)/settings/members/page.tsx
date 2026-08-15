import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { roleLabel } from "@/lib/schemas/membership";
import { formatISTDateTime } from "@/lib/format/date";
import { AddMemberForm } from "./AddMemberForm";
import { MemberAccessButton, MemberRoleSelect } from "./MemberControls";

export const metadata: Metadata = { title: "Members — Rakshana" };

export default async function MembersPage() {
  const scope = await requireOrgScope();
  if (!roleHasPermission(scope.role, "user.invite")) {
    return (
      <div className="space-y-6">
        <header>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Settings · Members
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Members</h1>
        </header>
        <Card>
          <CardContent className="p-12 text-center">
            <p className="font-display text-xl text-ink">Owners only.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Ask a trustee with the Owner role to add or change members.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // `Membership` is a SYSTEM_MODEL (src/lib/db/scoped-models.ts): the tenancy
  // extension passes it through untouched, so this organisationId — read off
  // the session — is the only thing keeping the list inside this trust.
  const members = await prisma.membership.findMany({
    where: { organisationId: scope.organisationId },
    include: { user: { select: { name: true, email: true, lastLoginAt: true } } },
    orderBy: [{ isActive: "desc" }, { joinedAt: "asc" }],
  });

  const activeOwners = members.filter((m) => m.isActive && m.role === "OWNER").length;
  const active = members.filter((m) => m.isActive).length;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Settings · Members
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Members</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {active} of {members.length} can sign in to {scope.organisationName}.
        </p>
        <Link
          href="/settings/organisation"
          className="mt-2 inline-block text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          Organisation profile
        </Link>
      </header>

      <Card>
        {/*
          A list rather than a table: four fields, a handful of rows, and two
          controls per row that a table would push off the side of a phone.
          Wrapping puts the name above its controls under 640px and back on
          one line above it, with no second copy of the row to keep in step.
        */}
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {members.map((m) => {
              // The one active owner left holds the only key to organisation
              // settings and to this screen. Demoting or switching them off
              // would lock the trust out with no self-service way back, so
              // the row shows the reason instead of a control that refuses.
              const lastOwner = m.isActive && m.role === "OWNER" && activeOwners === 1;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:flex-nowrap"
                >
                  <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <p className="truncate text-sm font-medium text-ink">{m.user.name}</p>
                    <p className="truncate text-xs text-ink-muted">{m.user.email}</p>
                    <p className="text-xs text-ink-subtle">
                      Last sign-in:{" "}
                      {m.user.lastLoginAt ? formatISTDateTime(m.user.lastLoginAt) : "Never"}
                    </p>
                  </div>
                  {lastOwner ? (
                    <span className="text-sm text-ink-muted">
                      {roleLabel(m.role)} · Last owner — keep one
                    </span>
                  ) : (
                    <>
                      <MemberRoleSelect membershipId={m.id} role={m.role} />
                      <span className="flex items-center gap-2">
                        {m.isActive ? null : <Badge variant="outline">No access</Badge>}
                        <MemberAccessButton membershipId={m.id} isActive={m.isActive} />
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <AddMemberForm />

      <p className="max-w-xl text-sm text-ink-muted">
        No invitation email is sent. Type the first password, hand it to the
        member yourself, and have them change it under{" "}
        <Link href="/settings/account" className="underline underline-offset-4 hover:text-ink">
          Your account
        </Link>
        . Removing access keeps the member&apos;s history — the record of what
        they entered stays intact.
      </p>
    </div>
  );
}
