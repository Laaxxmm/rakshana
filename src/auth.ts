import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { basePrisma } from "@/lib/db/prisma-base";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(basePrisma),
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12 hours, per SECURITY.md
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await basePrisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: {
            memberships: {
              where: { isActive: true },
              include: { organisation: { select: { id: true, name: true } } },
              orderBy: { joinedAt: "asc" },
              take: 1,
            },
          },
        });

        if (!user || !user.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        const active = user.memberships[0];
        if (!active) return null;

        await basePrisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          organisationId: active.organisationId,
          organisationName: active.organisation.name,
          role: active.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as { id: string }).id;
        token.organisationId = (user as { organisationId: string }).organisationId;
        token.organisationName = (user as { organisationName: string }).organisationName;
        token.role = (user as { role: import("@prisma/client").OrgRole }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.userId;
        session.user.organisationId = token.organisationId;
        session.user.organisationName = token.organisationName;
        session.user.role = token.role;
      }
      return session;
    },
  },
});
