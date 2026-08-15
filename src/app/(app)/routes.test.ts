import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page in this segment must be reachable by clicking.
 *
 * `src/app/routes.test.ts` runs the other direction — it proves the paths the
 * source names resolve to a route. It can never see a route that nothing links
 * to, which is how /beneficiaries, /volunteers and /volunteer-activities once
 * shipped with no way in but the address bar.
 *
 * The walk starts at the shell chrome (the rail, the bell, the user menu) and
 * follows links page to page. A page is reachable when the shell names it or a
 * page already reached names it.
 */

const SRC = path.join(process.cwd(), "src");
const APP = path.join(SRC, "app", "(app)");
const SHELL = path.join(SRC, "components", "shell");

/**
 * Pages that are deliberately not linked from the shell. Each line is a
 * decision someone has to defend in review; a route quietly failing the test
 * is not one of the options.
 */
const NOT_LINKED: Record<string, string> = {
  // The sidebar logo does link here, but a bare "/" is below the two-character
  // floor the link regex needs to tell a path from a stray string.
  "/": "the dashboard — the sidebar logo and the post-login redirect land here",
};

/**
 * Reached by ⌘K only. The palette is a shortcut for people who already know
 * the app, so a page listed here would still be lost to everyone else — the
 * list is empty on purpose and should stay that way.
 */
const PALETTE_ONLY: string[] = [];

/**
 * Hubs whose strip no page mounts yet. A hub in here is declared in HubNav but
 * invisible on screen, so its routes are reachable only through the one rail
 * icon that opens the hub — the siblings stay hidden until some page in the hub
 * renders `<HubNav hub="…" />`. Every declared hub now mounts, so the list is
 * empty and should stay that way: mounting the strip is the fix, not listing it.
 */
const UNMOUNTED_HUBS: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Files sitting directly in `dir`, ignoring sub-routes and tests. */
function filesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((e) => /\.tsx$/.test(e) && !/\.(test|spec)\.tsx$/.test(e))
    .map((e) => path.join(dir, e))
    .filter((p) => statSync(p).isFile());
}

/** Double-quoted in-app paths — the form every `href` in this codebase uses. */
function linksIn(files: string[]): string[] {
  return files.flatMap((f) => [
    ...readFileSync(f, "utf8").matchAll(/"(\/[a-z0-9][a-z0-9/-]*)"/g),
  ].map((m) => m[1]!.replace(/\/+$/, "")));
}

/**
 * URL path of every page.tsx, keyed to the directory it came from so the walk
 * can read that page's own outbound links.
 *
 * `route.ts` handlers are left out: they are downloads and webhooks, not
 * screens. Dynamic segments are left out too — a link to one is built with a
 * template literal, so its static prefix is what actually has to be reachable.
 */
function pages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(APP)) {
    if (path.basename(file) !== "page.tsx") continue;
    const dir = path.dirname(file);
    const segments = path.relative(APP, dir).split(path.sep).filter(Boolean);
    if (segments.some((s) => s.startsWith("["))) continue;
    found.set("/" + segments.join("/"), dir);
  }
  return found;
}

describe("route graph", () => {
  it("can reach every page from the shell", () => {
    const routeDirs = pages();

    // CommandPalette is excluded: its entries are a shortcut, not navigation.
    // HubNav is in, because it is shell chrome the hub pages mount.
    const shellFiles = filesIn(SHELL).filter(
      (f) => path.basename(f) !== "CommandPalette.tsx",
    );

    const reachable = new Set<string>([...Object.keys(NOT_LINKED)]);
    const queue = linksIn(shellFiles);

    while (queue.length > 0) {
      const link = queue.pop()!;
      // A link to /donors/17 makes /donors reachable, not the id page.
      const target = [...routeDirs.keys()]
        .filter((r) => link === r || link.startsWith(r + "/"))
        .sort((a, b) => b.length - a.length)[0];
      if (!target || reachable.has(target)) continue;
      reachable.add(target);
      queue.push(...linksIn(filesIn(routeDirs.get(target)!)));
    }

    const orphaned = [...routeDirs.keys()]
      .filter((r) => !reachable.has(r) && !PALETTE_ONLY.includes(r))
      .sort();

    expect(orphaned).toEqual([]);
  });

  it("keeps the exclusion lists honest", () => {
    const known = pages();
    const listed = [...Object.keys(NOT_LINKED), ...PALETTE_ONLY];
    expect(listed.filter((r) => !known.has(r))).toEqual([]);
  });

  it("mounts every hub strip on a page", () => {
    const source = readFileSync(path.join(SHELL, "HubNav.tsx"), "utf8");
    const declared = [...source.matchAll(/^ {2}([a-zA-Z]+): \[$/gm)].map((m) => m[1]!);
    expect(declared).not.toEqual([]);

    const mounted = new Set(
      walk(APP)
        .filter((f) => path.basename(f) === "page.tsx")
        .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/hub="([a-zA-Z]+)"/g)])
        .map((m) => m[1]!),
    );

    expect(declared.filter((h) => !mounted.has(h)).sort()).toEqual(
      [...UNMOUNTED_HUBS].sort(),
    );
  });
});
