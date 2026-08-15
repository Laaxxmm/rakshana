import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The route graph, checked in both directions. Each has shipped a bug.
 *
 * Down — every in-app path the source names must resolve to a route. Links are
 * plain strings, so nothing (not tsc, not the build) notices when a screen is
 * deleted and the links into it start leading to a 404.
 *
 * Up — every page must be reachable by clicking. The down direction can never
 * see a route that nothing links to, which is how /beneficiaries, /volunteers
 * and /volunteer-activities shipped with no way in but the address bar.
 */

const SRC = path.join(process.cwd(), "src");
const APP = path.join(SRC, "app");
const SEGMENT = path.join(APP, "(app)");
const SHELL = path.join(SRC, "components", "shell");

/**
 * Pages the walk is not expected to reach, and why each is acceptable. A page
 * that is neither reachable nor listed here fails the test: an entry is a
 * decision someone defends in review, not a way to go green.
 *
 * Two classes of page need no entry because the walk covers them:
 *   - `/…/new` and other child screens — reached from the list page that links
 *     them, so they are exactly as reachable as that list, which is the point.
 *   - `[id]` segments — a link to one is a template literal, so what has to be
 *     reachable is the list its row sits on. `entryRoute` maps them to it.
 */
const NOT_LINKED: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    // Tests may name a path deliberately (a 404 fixture, a removed screen),
    // so only shipped source counts.
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** URL paths of every page.tsx / route.ts, with the `(group)` folders dropped. */
function routes(): string[] {
  const found: string[] = [];
  for (const file of walk(APP)) {
    const base = path.basename(file);
    if (base !== "page.tsx" && base !== "route.ts") continue;
    const segments = path
      .relative(APP, path.dirname(file))
      .split(path.sep)
      .filter((s) => s && !s.startsWith("("));
    found.push("/" + segments.join("/"));
  }
  return found;
}

/**
 * Paths written as plain double-quoted strings. Dynamic links are built with
 * template literals and are skipped — their static prefix is covered by the
 * prefix rule below, and the id inside them cannot be checked here anyway.
 */
function pathLiterals(): Map<string, Set<string>> {
  const hits = new Map<string, Set<string>>();
  for (const file of walk(SRC)) {
    for (const m of readFileSync(file, "utf8").matchAll(/"(\/[a-z0-9][a-z0-9/-]*)"/g)) {
      const literal = m[1]!.replace(/\/+$/, "");
      const seen = hits.get(literal) ?? new Set<string>();
      seen.add(path.relative(process.cwd(), file));
      hits.set(literal, seen);
    }
  }
  return hits;
}

/** Files sitting directly in `dir` — the page and the components beside it. */
function filesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((e) => /\.tsx?$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e))
    .map((e) => path.join(dir, e))
    .filter((p) => statSync(p).isFile());
}

/**
 * Destinations only: `href="/x"`, `href={"/x"}` and the `href: "/x"` of a nav
 * table. A bare path elsewhere in the file does not count — the sidebar's
 * `alsoMatches` lists paths it highlights on, not paths it can take you to, and
 * counting those is what let an unreachable hub read as reachable.
 */
function hrefsIn(files: string[]): string[] {
  return files.flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/href[:=]\s*\{?\s*"(\/[a-z0-9/-]*)"/g)].map(
      (m) => m[1]!.replace(/(.)\/+$/, "$1"),
    ),
  );
}

/** URL path of every page under `(app)`, keyed to the directory it came from. */
function pages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(SEGMENT)) {
    if (path.basename(file) !== "page.tsx") continue;
    const dir = path.dirname(file);
    const segments = path.relative(SEGMENT, dir).split(path.sep).filter(Boolean);
    found.set("/" + segments.join("/"), dir);
  }
  return found;
}

/** The hub strips and the routes each links to, from the table that defines them. */
function hubLinks(): Map<string, string[]> {
  const source = readFileSync(path.join(SHELL, "HubNav.tsx"), "utf8");
  const hubs = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of source.split("\n")) {
    const opens = line.match(/^ {2}([a-zA-Z]+): \[$/);
    if (opens) {
      current = opens[1]!;
      hubs.set(current, []);
      continue;
    }
    if (!current) continue;
    if (/^ {2}\]/.test(line)) {
      current = null;
      continue;
    }
    const href = line.match(/href: "(\/[a-z0-9/-]*)"/);
    if (href) hubs.get(current)!.push(href[1]!);
  }
  return hubs;
}

/** Hubs whose strip these files render, so their siblings are on screen here. */
function hubsMountedIn(files: string[]): string[] {
  return files.flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/hub="([a-zA-Z]+)"/g)].map((m) => m[1]!),
  );
}

/**
 * The page a link lands on. `/donors/17` lands on /donors — the id page is
 * entered through the list, not linked by name. `/` only ever matches itself.
 */
function landsOn(link: string, known: string[]): string | undefined {
  return known
    .filter((r) => r === link || (r !== "/" && link.startsWith(r + "/")))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * The route that has to be reachable for a page to be usable. A static page is
 * its own; a `[id]` page is entered from the nearest list above it.
 */
function entryRoute(route: string, known: string[]): string | undefined {
  if (!route.includes("/[")) return route;
  return landsOn(route.split("/[")[0]!, known);
}

describe("route graph", () => {
  it("has a route behind every path the app names", () => {
    const known = routes();
    // A prefix counts: "/settings" has no page of its own but is a real
    // section — `pathname.startsWith("/settings")` and the prefix of a
    // catch-all such as /api/files/[...key] are both legitimate.
    const resolves = (p: string) =>
      known.some((r) => r === p || r.startsWith(p + "/"));

    const orphaned = [...pathLiterals()]
      .filter(([p]) => !resolves(p))
      .map(([p, files]) => `${p} (in ${[...files].join(", ")})`);

    expect(orphaned).toEqual([]);
  });

  it("can reach every page from the shell by clicking", () => {
    const routeDirs = pages();
    const known = [...routeDirs.keys()];
    const hubs = hubLinks();

    // The walk starts at chrome that is always on screen. CommandPalette is
    // left out because ⌘K is a shortcut for people who already know the app;
    // HubNav because a strip only exists where a page mounts it. Those two
    // exclusions are what give the test its teeth.
    const chrome = filesIn(SHELL).filter(
      (f) => !["CommandPalette.tsx", "HubNav.tsx"].includes(path.basename(f)),
    );
    const queue = hrefsIn(chrome);

    // Guards against the test going green because a regex stopped matching.
    expect(queue.length).toBeGreaterThan(0);
    expect(hubs.size).toBeGreaterThan(0);
    expect([...hubs].filter(([, links]) => links.length === 0)).toEqual([]);

    const reachable = new Set<string>();
    while (queue.length > 0) {
      const target = landsOn(queue.pop()!, known);
      if (!target || reachable.has(target)) continue;
      reachable.add(target);
      const files = filesIn(routeDirs.get(target)!);
      queue.push(...hrefsIn(files));
      for (const hub of hubsMountedIn(files)) queue.push(...(hubs.get(hub) ?? []));
    }

    const orphaned = known
      .filter((r) => !(r in NOT_LINKED))
      .filter((r) => {
        const entry = entryRoute(r, known);
        return !entry || !reachable.has(entry);
      })
      .sort();

    expect(orphaned).toEqual([]);
  });

  it("mounts every hub strip on a page", () => {
    const mounted = new Set(hubsMountedIn([...pages().values()].flatMap(filesIn)));
    const declared = [...hubLinks().keys()];

    expect(declared).not.toEqual([]);
    // No allowlist. A hub nobody mounts is a strip nobody can see: mount it, or
    // delete it from HubNav.
    expect(declared.filter((h) => !mounted.has(h))).toEqual([]);
  });

  it("keeps the exclusion list honest", () => {
    const known = pages();
    expect(Object.keys(NOT_LINKED).filter((r) => !known.has(r))).toEqual([]);
  });
});
