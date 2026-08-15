import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
          <h1 className="mt-1 font-display text-4xl text-ink">Members</h1>
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
        <h1 className="mt-1 font-display text-4xl text-ink">Members</h1>
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
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                // The one active owner left holds the only key to organisation
                // settings and to this screen. Demoting or switching them off
                // would lock the trust out with no self-service way back, so
                // the row shows the reason instead of a control that refuses.
                const lastOwner = m.isActive && m.role === "OWNER" && activeOwners === 1;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="text-sm font-medium text-ink">{m.user.name}</p>
                      <p className="text-xs text-ink-muted">{m.user.email}</p>
                    </TableCell>
                    <TableCell>
                      {lastOwner ? (
                        <span className="text-sm">{roleLabel(m.role)}</span>
                      ) : (
                        <MemberRoleSelect membershipId={m.id} role={m.role} />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">
                      {m.user.lastLoginAt ? formatISTDateTime(m.user.lastLoginAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {lastOwner ? (
                        <span className="text-xs text-ink-muted">
                          Last owner — keep one
                        </span>
                      ) : m.isActive ? (
                        <MemberAccessButton membershipId={m.id} isActive />
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <Badge variant="outline">No access</Badge>
                          <MemberAccessButton membershipId={m.id} isActive={false} />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
