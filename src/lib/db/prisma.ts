import { Prisma } from "@prisma/client";
import { basePrisma } from "./prisma-base";
import { getOrgScope } from "@/lib/auth/scope";
import {
  SCOPED_MODELS,
  SYSTEM_MODELS,
  PARENT_SCOPED_MODELS,
} from "./scoped-models";

/**
 * Operations whose `where` clause must carry organisationId.
 */
const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const WRITE_BY_WHERE_OPS = new Set([
  "updateMany",
  "deleteMany",
  "update",
  "delete",
  "upsert",
]);

/**
 * Operations that mutate the database — used to decide when to write an
 * AuditLog entry.
 */
const MUTATION_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function injectOrganisationId(args: AnyArgs, organisationId: string): AnyArgs {
  const next: AnyArgs = { ...args };
  if (next.where) {
    next.where = { ...next.where, organisationId };
  } else {
    next.where = { organisationId };
  }
  return next;
}

function injectIntoData(
  data: Record<string, unknown> | Array<Record<string, unknown>>,
  organisationId: string,
) {
  if (Array.isArray(data)) {
    return data.map((row) =>
      "organisationId" in row ? row : { ...row, organisationId },
    );
  }
  return "organisationId" in data ? data : { ...data, organisationId };
}

/**
 * Rakshana Prisma client.
 *
 * - Auto-scopes every query against a model with `organisationId` to the
 *   current session's organisation.
 * - Writes an AuditLog entry after every successful mutation on a scoped
 *   model (except AuditLog itself, to avoid recursion).
 * - Throws if a scoped operation is attempted without a session.
 *
 * Escape hatch: `prismaUnsafe` (re-exported below) is the unscoped client.
 * Every use of `prismaUnsafe` outside auth / seed / system tooling MUST be
 * justified in `REUSE-MAP.md` under "Database escape hatch usage".
 */
export const prisma = basePrisma.$extends({
  name: "rakshana-tenancy+audit",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const modelName = String(model ?? "");

        if (SYSTEM_MODELS.has(modelName) || PARENT_SCOPED_MODELS.has(modelName)) {
          return query(args);
        }

        if (!SCOPED_MODELS.has(modelName)) {
          return query(args);
        }

        const scope = await getOrgScope();
        if (!scope?.organisationId) {
          throw new Error(
            `[tenancy] No org scope available for ${modelName}.${operation}. ` +
              `Use \`prismaUnsafe\` for system-level operations (seed, auth, super-admin) ` +
              `and document the call in REUSE-MAP.md.`,
          );
        }
        const orgId = scope.organisationId;

        let nextArgs = args as AnyArgs;

        if (READ_OPS.has(operation) || WRITE_BY_WHERE_OPS.has(operation)) {
          nextArgs = injectOrganisationId(nextArgs, orgId);
        }

        if (operation === "create" && nextArgs.data) {
          nextArgs = {
            ...nextArgs,
            data: injectIntoData(
              nextArgs.data as Record<string, unknown>,
              orgId,
            ),
          };
        }
        if (operation === "createMany" || operation === "createManyAndReturn") {
          if (nextArgs.data) {
            nextArgs = {
              ...nextArgs,
              data: injectIntoData(
                nextArgs.data as Array<Record<string, unknown>>,
                orgId,
              ),
            };
          }
        }
        if (operation === "upsert" && nextArgs.create) {
          const create = nextArgs.create as Record<string, unknown>;
          nextArgs = {
            ...nextArgs,
            create: "organisationId" in create
              ? create
              : { ...create, organisationId: orgId },
          };
        }

        const result = await query(nextArgs);

        // ---- Audit hook ----
        // Skip auditing the AuditLog itself.
        if (
          MUTATION_OPS.has(operation) &&
          modelName !== "AuditLog" &&
          SCOPED_MODELS.has(modelName)
        ) {
          await writeAuditEntry({
            organisationId: orgId,
            userId: scope.userId,
            modelName,
            operation,
            args: nextArgs,
            result,
          });
        }

        return result;
      },
    },
  },
});

/**
 * Unscoped client. Required for:
 *   1. NextAuth adapter (reads/writes User, Account, Session, VerificationToken)
 *   2. Seed scripts (run outside an HTTP session)
 *   3. Future super-admin tooling
 *
 * EVERY OTHER USE MUST BE DOCUMENTED IN REUSE-MAP.md.
 */
export { basePrisma as prismaUnsafe } from "./prisma-base";

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

type AuditInput = {
  organisationId: string;
  userId: string | null;
  modelName: string;
  operation: string;
  args: AnyArgs;
  result: unknown;
};

async function writeAuditEntry(input: AuditInput): Promise<void> {
  const action = `${input.modelName}.${input.operation}`;

  // Best-effort entityId resolution.
  const entityId = resolveEntityId(input.args, input.result);
  const after = serialiseForAudit(captureAfter(input.operation, input.result));

  try {
    await basePrisma.auditLog.create({
      data: {
        organisationId: input.organisationId,
        userId: input.userId,
        action,
        entityType: input.modelName,
        entityId: entityId ?? "(bulk)",
        before: Prisma.DbNull,
        after: (after ?? Prisma.DbNull) as Prisma.InputJsonValue,
        ipAddress: null,
        userAgent: null,
      },
    });
  } catch (err) {
    // Audit failure must NOT mask the original write — log and swallow.
    if (process.env.NODE_ENV !== "production") {
      console.error("[audit] failed to write entry", action, err);
    }
  }
}

function resolveEntityId(args: AnyArgs, result: unknown): string | null {
  if (result && typeof result === "object" && "id" in result) {
    return String((result as { id: unknown }).id);
  }
  if (args.where && typeof args.where === "object") {
    const where = args.where as Record<string, unknown>;
    if (typeof where.id === "string") return where.id;
  }
  return null;
}

function captureAfter(operation: string, result: unknown): unknown {
  if (operation === "delete" || operation === "deleteMany") return null;
  return result;
}

function serialiseForAudit(value: unknown): import("@prisma/client").Prisma.InputJsonValue {
  // Decimal, Date, BigInt → JSON-safe.
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v && typeof v === "object" && "toString" in v && v.constructor?.name === "Decimal") {
        return (v as { toString(): string }).toString();
      }
      return v;
    }),
  );
}
