import type { OrgRole } from "@prisma/client";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      organisationId: string;
      organisationName: string;
      role: OrgRole;
    };
  }

  interface User {
    id?: string;
    email?: string | null;
    name?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    organisationId: string;
    organisationName: string;
    role: OrgRole;
  }
}
