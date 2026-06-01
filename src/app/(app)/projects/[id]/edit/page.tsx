import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { ProjectForm } from "../../ProjectForm";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata: Metadata = { title: "Edit project — Rakshana" };

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireOrgScope();
  const [project, managers] = await Promise.all([
    prisma.project.findUnique({ where: { id } }),
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
  ]);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href={`/projects/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to project
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Edit project</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          {project.name}
        </h1>
      </header>
      <ProjectForm
        mode="edit"
        projectId={id}
        managers={managers}
        defaults={{
          code: project.code,
          name: project.name,
          description: project.description ?? "",
          startDate: project.startDate?.toISOString().slice(0, 10) ?? "",
          endDate: project.endDate?.toISOString().slice(0, 10) ?? "",
          managerId: project.managerId ?? "",
          isCsr: project.isCsr,
          totalBudget: project.totalBudget.toString(),
        }}
      />
    </div>
  );
}
