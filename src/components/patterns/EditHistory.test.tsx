import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuditDetail, type EditHistoryEntry } from "./EditHistory";

function entry(partial: Partial<EditHistoryEntry>): EditHistoryEntry {
  return {
    id: "audit-1",
    action: "Donor.update",
    entityType: "Donor",
    entityId: "donor-1",
    createdAt: "2026-05-01T06:30:00.000Z",
    userName: "Priya",
    before: null,
    after: null,
    ...partial,
  };
}

// The row an audit entry carries: a handful of filled columns and a long tail
// of nulls, which is what used to render as thirty "before — / after —" rows.
const DONOR_ROW = {
  id: "donor-1",
  organisationId: "org-1",
  createdAt: "2026-05-01T06:30:00.000Z",
  updatedAt: "2026-05-01T06:30:00.000Z",
  name: "Anitha Rao",
  donorType: "INDIVIDUAL",
  pan: "ABCPR1234K",
  phone: null,
  email: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  district: null,
  state: null,
  pincode: null,
  internalNotes: null,
  isCsrDonor: false,
  isFcraEligible: false,
  tags: [],
};

describe("AuditDetail", () => {
  it("renders a creation as a summary of the fields that hold a value", () => {
    const html = renderToStaticMarkup(
      <AuditDetail entry={entry({ action: "Donor.create", after: DONOR_ROW })} />,
    );

    expect(html).toContain("Created with");
    expect(html).toContain("Anitha Rao");
    expect(html).toContain("ABCPR1234K");
    // No before/after table, and therefore no column of dashes.
    expect(html).not.toContain("before");
    expect(html).not.toContain("—");
    // Empty columns are left out entirely.
    expect(html).not.toContain("phone");
    expect(html).not.toContain("internalNotes");
    // So are the columns the ORM maintains.
    expect(html).not.toContain("organisationId");
    expect(html).not.toContain("updatedAt");
  });

  it("shows only the fields that differ when both sides were recorded", () => {
    const html = renderToStaticMarkup(
      <AuditDetail
        entry={entry({
          before: { ...DONOR_ROW, phone: "9845000000" },
          after: { ...DONOR_ROW, phone: "9845000000", city: "Bengaluru" },
        })}
      />,
    );

    expect(html).toContain("city");
    expect(html).toContain("Bengaluru");
    // Unchanged, untouched and ORM-managed columns stay out of the panel.
    expect(html).not.toContain("phone");
    expect(html).not.toContain("Anitha Rao");
    expect(html).not.toContain("updatedAt");
  });

  it("does not count a field that is null on one side and absent on the other", () => {
    const html = renderToStaticMarkup(
      <AuditDetail
        entry={entry({
          before: { name: "Anitha Rao" },
          after: { name: "Anitha Rao", email: null, remarks: "" },
        })}
      />,
    );

    expect(html).toContain("No field-level changes recorded.");
  });

  it("says so plainly when a delete kept no field values", () => {
    const html = renderToStaticMarkup(
      <AuditDetail entry={entry({ action: "Donor.delete", after: null })} />,
    );

    expect(html).toContain("The record was deleted.");
  });
});
