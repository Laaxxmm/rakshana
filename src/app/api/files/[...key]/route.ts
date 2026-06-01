import { NextResponse } from "next/server";
import { requireOrgScope } from "@/lib/auth/scope";
import { storage, parseStorageKey } from "@/lib/storage";

/**
 * Secured file streaming endpoint.
 *
 * Files live behind this route — never on a public URL. We verify that the
 * requesting user belongs to the organisation embedded in the key BEFORE
 * streaming a byte.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");

  const parsed = parseStorageKey(key);
  if (!parsed) {
    return new NextResponse("Not found", { status: 404 });
  }

  let scope;
  try {
    scope = await requireOrgScope();
  } catch {
    return new NextResponse("Unauthorised", { status: 401 });
  }
  if (scope.organisationId !== parsed.orgId) {
    // Cross-tenant attempt — treat as not found, not 403, to avoid leaking
    // the existence of the file.
    return new NextResponse("Not found", { status: 404 });
  }

  const obj = await storage.get(key);
  if (!obj) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(obj.stream, {
    status: 200,
    headers: {
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=60",
    },
  });
}
