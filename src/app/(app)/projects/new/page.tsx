import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { ProjectForm } from "../ProjectForm";
import { prismaUnsafe } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { getCurrentFY } from "@/lib/format/date";

export const metadata: Metadata = { title: "New project — Rakshana" };

export default async function NewProjectPage() {
  const scope = await requireOrgScope();
  const fy = getCurrentFY();

  const [managers, lastProject] = await Promise.all([
    prismaUnsafe.user.findMany({
      where: {
        memberships: {
          some: {
            organisationId: scope.organisationId,
            isActive: true,
            role: { in: ["OWNER", "ADMIN", "PROJECT_MANAGER"] },
          },
        },
      },
      select: { id: true, name: true, email: true },
    }),
    prismaUnsafe.project.findFirst({
      where: { organisationId: scope.organisationId },
      orderBy: { createdAt: "desc" },
      select: { code: true },
    }),
  ]);

  // Suggest the next code in the PRJ/{FY}/XXXX pattern
  const lastNum = lastProject?.code.match(/PRJ\/[\d-]+\/(\d+)/)?.[1];
  const nextNum = lastNum ? String(Number(lastNum) + 1).padStart(4, "0") : "0001";
  const suggestedCode = `PRJ/${fy}/${nextNum}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to projects
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New project</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Create a project
        </h1>
      </header>
      <ProjectForm
        mode="create"
        managers={managers}
        defaults={{
          code: suggestedCode,
          name: "",
          description: "",
          startDate: "",
          endDate: "",
          managerId: "",
          isCsr: false,
          totalBudget: "0",
        }}
      />
    </div>
  );
}
