import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ErrorState } from "./ErrorState";
import AppSegmentError from "@/app/(app)/error";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";

const noop = () => {};

function crash(digest?: string) {
  return Object.assign(new Error('column "gstNumber" of relation "Donor" does not exist'), {
    digest,
  });
}

describe("error boundaries", () => {
  it("shows the digest, which is all anyone has to report a failure with", () => {
    const html = renderToStaticMarkup(<ErrorState digest="2748291035" reset={noop} />);
    expect(html).toContain("2748291035");
  });

  it("never prints the thrown message", () => {
    for (const html of [
      renderToStaticMarkup(<AppSegmentError error={crash("aa11")} reset={noop} />),
      renderToStaticMarkup(<RootError error={crash("bb22")} reset={noop} />),
      renderToStaticMarkup(<GlobalError error={crash("cc33")} reset={noop} />),
    ]) {
      expect(html).not.toContain("gstNumber");
      expect(html).not.toContain("relation");
    }
  });

  it("carries the digest through every boundary", () => {
    expect(renderToStaticMarkup(<AppSegmentError error={crash("aa11")} reset={noop} />)).toContain("aa11");
    expect(renderToStaticMarkup(<RootError error={crash("bb22")} reset={noop} />)).toContain("bb22");
    expect(renderToStaticMarkup(<GlobalError error={crash("cc33")} reset={noop} />)).toContain("cc33");
  });

  it("still offers a retry and a way out when there is no digest", () => {
    const html = renderToStaticMarkup(<ErrorState reset={noop} />);
    expect(html).toContain("Try again");
    expect(html).toContain('href="/"');
  });

  it("sends a signed-out visitor to the login screen, not the dashboard", () => {
    expect(renderToStaticMarkup(<RootError error={crash()} reset={noop} />)).toContain(
      'href="/login"',
    );
  });
});
