import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { TabsList, TabsTrigger, tabsListVariants } from "./tabs";

/**
 * The active tab used to be a `--background` pill on a `--muted` strip: two
 * near-white greys, indistinguishable in the screenshots users sent in. These
 * assertions pin the contrast contract rather than the exact styling — the
 * active tab must differ from its neighbours in fill *and* in text colour,
 * and the tabs must not sit flush against each other.
 *
 * Read as strings because Tailwind state variants are compiled: both triggers
 * carry the same class list and the browser picks the active branch, so there
 * is nothing to observe by rendering one.
 */
function classNameOf(element: ReactElement): string {
  return (element.props as { className?: string }).className ?? "";
}

describe("tabs contrast", () => {
  const trigger = classNameOf(TabsTrigger({ value: "overview", children: "Overview" }));
  const list = classNameOf(TabsList({ children: null }));

  it("paints the active tab with the brand colour, not another shade of grey", () => {
    expect(trigger).toContain("data-active:bg-primary-soft");
    expect(trigger).toContain("data-active:text-primary");
    expect(trigger).not.toContain("data-active:bg-background");
  });

  it("keeps inactive tabs muted so the active one reads as the odd one out", () => {
    expect(trigger).toContain("text-ink-muted");
    expect(trigger).toContain("data-active:font-semibold");
  });

  it("never lets hover repaint the active tab", () => {
    expect(trigger).toContain("not-data-active:hover:bg-surface-sunken");
  });

  it("spaces the tabs apart instead of running them together", () => {
    expect(list).toContain("gap-2");
    expect(trigger).toContain("px-3.5");
    expect(trigger).toContain("py-2");
  });

  it("gives the strip no fill of its own, in every variant", () => {
    for (const variant of ["default", "line"] as const) {
      expect(tabsListVariants({ variant })).not.toContain("bg-muted");
    }
  });
});
