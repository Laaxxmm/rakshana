import { auth } from "@/auth";
import { cache } from "react";
import type { OrgRole } from "@prisma/client";

export type OrgScope = {
  userId: string;
  organisationId: string;
  organisationName: string;
  role: OrgRole;
};

export const getOrgScope = cache(async (): Promise<OrgScope | null> => {
  const session = await auth();
  if (!session?.user?.organisationId) return null;
  return {
    userId: session.user.id,
    organisationId: session.user.organisationId,
    organisationName: session.user.organisationName,
    role: session.user.role,
  };
});

export async function requireOrgScope(): Promise<OrgScope> {
  const s = await getOrgScope();
  if (!s) throw new Error("Authentication required");
  return s;
}
