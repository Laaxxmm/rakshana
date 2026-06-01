import { describe, expect, it } from "vitest";
import {
  WorkflowError,
  assertTransition,
  canTransition,
  nextStatus,
} from "./expense-workflow";

describe("expense workflow state machine", () => {
  describe("legal transitions", () => {
    it("DRAFT → PENDING_APPROVAL on submit (no auto-approve)", () => {
      expect(nextStatus("submit", "DRAFT", { autoApprove: false })).toBe("PENDING_APPROVAL");
    });
    it("DRAFT → APPROVED on submit (auto-approve)", () => {
      expect(nextStatus("submit", "DRAFT", { autoApprove: true })).toBe("APPROVED");
    });
    it("PENDING_APPROVAL → APPROVED", () => {
      expect(nextStatus("approve", "PENDING_APPROVAL")).toBe("APPROVED");
    });
    it("PENDING_APPROVAL → REJECTED", () => {
      expect(nextStatus("reject", "PENDING_APPROVAL")).toBe("REJECTED");
    });
    it("APPROVED → PAID", () => {
      expect(nextStatus("markPaid", "APPROVED")).toBe("PAID");
    });
    it("REJECTED → DRAFT (reopen)", () => {
      expect(nextStatus("reopen", "REJECTED")).toBe("DRAFT");
    });
    it("DRAFT / PENDING_APPROVAL / APPROVED / PAID → CANCELLED", () => {
      expect(nextStatus("cancel", "DRAFT")).toBe("CANCELLED");
      expect(nextStatus("cancel", "PENDING_APPROVAL")).toBe("CANCELLED");
      expect(nextStatus("cancel", "APPROVED")).toBe("CANCELLED");
      expect(nextStatus("cancel", "PAID")).toBe("CANCELLED");
    });
  });

  describe("illegal transitions throw WorkflowError", () => {
    it("cannot submit an APPROVED expense", () => {
      expect(() => assertTransition("submit", "APPROVED")).toThrow(WorkflowError);
    });
    it("cannot approve a DRAFT", () => {
      expect(() => assertTransition("approve", "DRAFT")).toThrow(WorkflowError);
    });
    it("cannot approve a CANCELLED expense", () => {
      expect(() => assertTransition("approve", "CANCELLED")).toThrow(WorkflowError);
    });
    it("cannot markPaid a PENDING_APPROVAL expense", () => {
      expect(() => assertTransition("markPaid", "PENDING_APPROVAL")).toThrow(WorkflowError);
    });
    it("cannot reopen an APPROVED expense", () => {
      expect(() => assertTransition("reopen", "APPROVED")).toThrow(WorkflowError);
    });
    it("cannot cancel a REJECTED expense (must reopen first)", () => {
      expect(() => assertTransition("cancel", "REJECTED")).toThrow(WorkflowError);
    });
    it("cannot cancel an already-CANCELLED expense", () => {
      expect(() => assertTransition("cancel", "CANCELLED")).toThrow(WorkflowError);
    });
  });

  describe("canTransition", () => {
    it("returns true / false without throwing", () => {
      expect(canTransition("submit", "DRAFT")).toBe(true);
      expect(canTransition("submit", "APPROVED")).toBe(false);
      expect(canTransition("approve", "PENDING_APPROVAL")).toBe(true);
      expect(canTransition("approve", "APPROVED")).toBe(false);
    });
  });
});
