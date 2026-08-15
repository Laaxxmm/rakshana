import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * A phone hides the rail, so every destination the rail carries has to be
 * somewhere else at that width. Twice already a route has shipped with no way
 * in but the address bar — `src/app/(app)/routes.test.ts` is the desktop half
 * of that guard, and this is the same failure with a viewport attached.
 *
 * Both navs are rendered and compared by href. Vitest runs in `node`, so what
 * this cannot see is the CSS that hides one or the other; the responsive
 * switch is pinned as a class contract instead, the way `ui/tabs.test.tsx`
 * pins its contrast contract.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/donations",
  // The palette in the top bar reaches for it on render.
  useRouter: () => ({ push: () => {} }),
}));
// An async server component nested in another one suspends under
// `renderToStaticMarkup`. The bell carries no rail destination, so it is stood
// down rather than worked around.
vi.mock("./NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/lib/actions/search", () => ({
  searchEverything: async () => ({ data: [] }),
}));
vi.mock("@/auth", () => ({
  auth: async () => ({
    user: {
      name: "A Volunteer",
      email: "volunteer@example.org",
      role: "VOLUNTEER",
      organisationName: "Rakshana Charitable Trust",
    },
  }),
}));

const { MobileNav, Sidebar } = await import("./Sidebar");
const { TopBar } = await import("./TopBar");

const railHtml = renderToStaticMarkup(
  <Sidebar organisationName="Rakshana Charitable Trust" />,
);
const mobileHtml = renderToStaticMarkup(<MobileNav />);
const topBarHtml = renderToStaticMarkup(await TopBar());

function hrefs(html: string): Set<string> {
  return new Set([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!));
}

/** The class list of the outermost element, which is the nav's own. */
function rootClasses(html: string): string {
  return html.match(/class="([^"]*)"/)?.[1] ?? "";
}

/**
 * Rail links a phone reaches through chrome that renders nothing until it is
 * opened, so no markup here can show them. Each maps to the shell file that
 * carries it, which the second test holds to its word.
 */
const ELSEWHERE: Record<string, string> = {
  // The account menu, whose popup is mounted on open.
  "/settings/organisation": "UserMenu.tsx",
};

describe("mobile navigation", () => {
  it("keeps every rail destination reachable on a phone", () => {
    const onPhone = new Set([...hrefs(mobileHtml), ...hrefs(topBarHtml)]);

    const missing = [...hrefs(railHtml)].filter(
      (href) => !onPhone.has(href) && !(href in ELSEWHERE),
    );

    expect(missing).toEqual([]);
  });

  it("keeps the exclusion list honest", () => {
    for (const [href, file] of Object.entries(ELSEWHERE)) {
      expect(hrefs(railHtml)).toContain(href);
      const source = readFileSync(
        path.join(process.cwd(), "src", "components", "shell", file),
        "utf8",
      );
      expect(source).toContain(`"${href}"`);
    }
  });

  it("shows exactly one of the two navs at any width", () => {
    expect(rootClasses(railHtml)).toContain("hidden");
    expect(rootClasses(railHtml)).toContain("md:flex");
    expect(rootClasses(mobileHtml)).toContain("md:hidden");
  });

  it("gives every cell a thumb-sized target", () => {
    const cells = [...mobileHtml.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);

    expect(cells.length).toBeGreaterThan(0);
    // 56px, against a 44px floor.
    for (const cell of cells) expect(cell).toContain("min-h-14");
  });
});
