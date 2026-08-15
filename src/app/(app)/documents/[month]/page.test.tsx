import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LibraryDoc } from "../library";

/**
 * What "preview" means on a phone.
 *
 * A PDF in a 375px iframe is a postage stamp with no zoom, no search and no
 * share; the viewer already on the device has all three. So under `lg` the
 * month page is a list and each row hands the file straight to that viewer,
 * while the in-page preview — and the second link that selects into it —
 * belongs to the wide layout.
 *
 * No pixels are asserted: vitest has no layout engine. What is asserted is
 * where each row points, which is the honest half of that decision.
 */

vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u1",
    organisationId: "o1",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound()");
  },
  redirect: (to: string) => {
    throw new Error(`redirect(${to})`);
  },
}));

const loadLibrary = vi.fn();
vi.mock("../library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../library")>()),
  loadLibrary: (month: string) => loadLibrary(month),
}));

const DocumentMonthPage = (await import("./page")).default;

const BILL: LibraryDoc = {
  id: "bill-att-1",
  month: "2026-03",
  date: new Date("2026-03-11T00:00:00.000Z"),
  kind: "Bill",
  title: "Printer repair — March",
  contentType: "application/pdf",
  url: "/api/files/org%2Fo1%2Fbill.pdf",
  attachedTo: "Expense EXP/2025-26/0031",
  href: "/expenses?open=exp-1",
};

async function render(docs: LibraryDoc[] = [BILL]) {
  loadLibrary.mockResolvedValue(docs);
  return renderToStaticMarkup(
    await DocumentMonthPage({
      params: Promise.resolve({ month: "2026-03" }),
      searchParams: Promise.resolve({}),
    }),
  );
}

/**
 * The list of documents alone. The preview pane carries its own Open button
 * at the same URL, so an assertion about what a *row* does has to be made
 * inside the list or it proves nothing.
 */
function listMarkup(html: string): string {
  const start = html.indexOf("<ul");
  const end = html.indexOf("</ul>");
  if (start < 0 || end < 0) throw new Error("the month page rendered no list");
  return html.slice(start, end);
}

describe("document month page", () => {
  it("opens the file itself from the row a phone sees", async () => {
    const list = listMarkup(await render());

    // The row is the file: one tap, into whatever the device opens PDFs with.
    expect(list).toMatch(
      /<a[^>]*href="\/api\/files\/org%2Fo1%2Fbill\.pdf"[^>]*target="_blank"/,
    );
  });

  it("keeps the in-page selection for the wide layout", async () => {
    const html = await render();

    // The same document, reached the other way — the link that drives the
    // preview pane is still there for a screen that has room for one.
    expect(listMarkup(html)).toContain('href="/documents/2026-03?doc=bill-att-1"');
    expect(html).toContain("Printer repair — March");
  });

  it("never spends a phone's data on the preview it cannot use", async () => {
    const html = await render();

    // The pane is display:none under lg, and a lazy iframe that is never near
    // a viewport is never fetched.
    expect(html).toMatch(/<iframe[^>]*loading="lazy"/);
  });

  it("says so plainly when the month is empty", async () => {
    const html = await render([]);

    expect(html).toContain("Nothing filed this month.");
    expect(html).not.toContain("<iframe");
  });
});
