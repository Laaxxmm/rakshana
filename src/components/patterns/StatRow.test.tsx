import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatRow } from "./StatRow";

describe("StatRow", () => {
  it("keeps every figure in its own labelled block", () => {
    const html = renderToStaticMarkup(
      <StatRow
        stats={[
          { label: "Financial year", value: "2026-27" },
          { label: "Gross", value: "₹0.00" },
          { label: "Vouchers", value: "0" },
        ]}
      />,
    );

    // No interpunct run-on: the strip the users complained about was one
    // sentence, so a label must never be glued to the previous value.
    expect(html).not.toContain("·");
    expect(html).toContain(">Financial year<");
    expect(html).toContain(">Gross<");
    expect(html.match(/<dt /g)).toHaveLength(3);
    expect(html.match(/<dd /g)).toHaveLength(3);
  });

  it("renders a missing figure as an em dash rather than blank", () => {
    const html = renderToStaticMarkup(<StatRow stats={[{ label: "TDS", value: null }]} />);
    expect(html).toContain("—");
  });
});
