import { describe, expect, it } from "vitest";
import { storageKey, parseStorageKey } from "./keys";
import { parseISTInput } from "@/lib/format/date";

describe("expenseBill keys", () => {
  it("files a bill under the month of the expense date, in IST", () => {
    // Stored as 2027-02-28T18:30:00Z — formatting in UTC would file a March
    // bill under February and break the audit prefix.
    const key = storageKey.expenseBill(
      "org1",
      parseISTInput("01/03/2027"),
      "att1",
      "image/webp",
    );
    expect(key).toBe("org/org1/bills/2027/03/att1.webp");
  });

  it("round-trips through parseStorageKey so /api/files can org-check it", () => {
    expect(parseStorageKey("org/org1/bills/2027/03/att1.webp")).toEqual({
      orgId: "org1",
      kind: "bills",
      year: "2027",
      month: "03",
      attachmentId: "att1",
    });
  });
});
