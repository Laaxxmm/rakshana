import { describe, expect, it } from "vitest";
import {
  ProjectWorkflowError,
  assertProjectTransition,
  canProjectTransition,
  nextProjectStatus,
  actionForTargetStatus,
} from "./project-workflow";

describe("project workflow", () => {
  describe("legal transitions", () => {
    it("PLANNED → ACTIVE", () => {
      expect(nextProjectStatus("activate", "PLANNED")).toBe("ACTIVE");
    });
    it("ACTIVE → ON_HOLD", () => {
      expect(nextProjectStatus("hold", "ACTIVE")).toBe("ON_HOLD");
    });
    it("ACTIVE → COMPLETED", () => {
      expect(nextProjectStatus("complete", "ACTIVE")).toBe("COMPLETED");
    });
    it("ON_HOLD → ACTIVE via resume", () => {
      expect(nextProjectStatus("resume", "ON_HOLD")).toBe("ACTIVE");
    });
    it("ON_HOLD → ACTIVE via activate (operational shortcut)", () => {
      expect(nextProjectStatus("activate", "ON_HOLD")).toBe("ACTIVE");
    });
    it("any of PLANNED/ACTIVE/ON_HOLD → CANCELLED", () => {
      expect(nextProjectStatus("cancel", "PLANNED")).toBe("CANCELLED");
      expect(nextProjectStatus("cancel", "ACTIVE")).toBe("CANCELLED");
      expect(nextProjectStatus("cancel", "ON_HOLD")).toBe("CANCELLED");
    });
  });

  describe("illegal transitions throw", () => {
    it("cannot complete a PLANNED project", () => {
      expect(() => assertProjectTransition("complete", "PLANNED")).toThrow(ProjectWorkflowError);
    });
    it("cannot hold a PLANNED project", () => {
      expect(() => assertProjectTransition("hold", "PLANNED")).toThrow(ProjectWorkflowError);
    });
    it("COMPLETED is terminal", () => {
      expect(() => assertProjectTransition("activate", "COMPLETED")).toThrow();
      expect(() => assertProjectTransition("hold", "COMPLETED")).toThrow();
      expect(() => assertProjectTransition("cancel", "COMPLETED")).toThrow();
    });
    it("CANCELLED is terminal", () => {
      expect(() => assertProjectTransition("activate", "CANCELLED")).toThrow();
    });
  });

  describe("canProjectTransition", () => {
    it("returns true/false without throwing", () => {
      expect(canProjectTransition("activate", "PLANNED")).toBe(true);
      expect(canProjectTransition("complete", "PLANNED")).toBe(false);
    });
  });

  describe("actionForTargetStatus", () => {
    it("resolves to activate when going to ACTIVE", () => {
      expect(actionForTargetStatus("PLANNED", "ACTIVE")).toBe("activate");
    });
    it("returns null for an illegal target", () => {
      expect(actionForTargetStatus("CANCELLED", "ACTIVE")).toBeNull();
    });
  });
});
