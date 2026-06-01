import { describe, expect, it } from "vitest";
import { roleHasPermission, PERMISSIONS } from "./permissions";

describe("permissions matrix", () => {
  it("OWNER has every permission", () => {
    for (const key of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(roleHasPermission("OWNER", key), key).toBe(true);
    }
  });

  it("VIEWER cannot create donations", () => {
    expect(roleHasPermission("VIEWER", "donation.create")).toBe(false);
  });

  it("ACCOUNTANT can approve expenses up to ₹10k but not unlimited", () => {
    expect(roleHasPermission("ACCOUNTANT", "expense.approve.upto10k")).toBe(true);
    expect(roleHasPermission("ACCOUNTANT", "expense.approve.unlimited")).toBe(false);
  });

  it("AUDITOR is read-only across financial modules", () => {
    expect(roleHasPermission("AUDITOR", "donation.view")).toBe(true);
    expect(roleHasPermission("AUDITOR", "expense.view")).toBe(true);
    expect(roleHasPermission("AUDITOR", "donation.create")).toBe(false);
    expect(roleHasPermission("AUDITOR", "expense.approve.upto10k")).toBe(false);
    expect(roleHasPermission("AUDITOR", "audit.view")).toBe(true);
  });

  it("PROJECT_MANAGER can manage projects and beneficiaries, not donations", () => {
    expect(roleHasPermission("PROJECT_MANAGER", "project.edit")).toBe(true);
    expect(roleHasPermission("PROJECT_MANAGER", "beneficiary.manage")).toBe(true);
    expect(roleHasPermission("PROJECT_MANAGER", "donation.create")).toBe(false);
  });

  it("Only OWNER can edit org settings or invite users", () => {
    expect(roleHasPermission("OWNER", "org.settings.edit")).toBe(true);
    expect(roleHasPermission("ADMIN", "org.settings.edit")).toBe(false);
    expect(roleHasPermission("ADMIN", "user.invite")).toBe(false);
  });
});
