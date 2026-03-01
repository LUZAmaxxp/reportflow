import { describe, it, expect } from "vitest";
import { isValidTransition, type ObservationStatus, type TransitionRole } from "@/lib/observations/stateMachine";

describe("ObservationStateMachine", () => {
  describe("candidate transitions", () => {
    it("allows candidate → approved for editor", () => {
      expect(isValidTransition("candidate", "approved", "editor")).toBe(true);
    });

    it("allows candidate → approved for admin", () => {
      expect(isValidTransition("candidate", "approved", "admin")).toBe(true);
    });

    it("allows candidate → approved for system", () => {
      expect(isValidTransition("candidate", "approved", "system")).toBe(true);
    });

    it("allows candidate → rejected for editor", () => {
      expect(isValidTransition("candidate", "rejected", "editor")).toBe(true);
    });

    it("rejects candidate → approved for viewer", () => {
      expect(isValidTransition("candidate", "approved", "viewer")).toBe(false);
    });

    it("rejects candidate → rejected for viewer", () => {
      expect(isValidTransition("candidate", "rejected", "viewer")).toBe(false);
    });
  });

  describe("rejected transitions", () => {
    it("allows rejected → candidate for editor (reconsider)", () => {
      expect(isValidTransition("rejected", "candidate", "editor")).toBe(true);
    });

    it("allows rejected → candidate for admin (reconsider)", () => {
      expect(isValidTransition("rejected", "candidate", "admin")).toBe(true);
    });

    it("rejects rejected → approved directly", () => {
      expect(isValidTransition("rejected", "approved", "editor")).toBe(false);
    });

    it("rejects rejected → candidate for viewer", () => {
      expect(isValidTransition("rejected", "candidate", "viewer")).toBe(false);
    });
  });

  describe("superseded transitions", () => {
    it("allows superseded → approved for editor", () => {
      expect(isValidTransition("superseded", "approved", "editor")).toBe(true);
    });

    it("allows superseded → approved for admin", () => {
      expect(isValidTransition("superseded", "approved", "admin")).toBe(true);
    });

    it("rejects superseded → approved for viewer", () => {
      expect(isValidTransition("superseded", "approved", "viewer")).toBe(false);
    });
  });

  describe("approved transitions", () => {
    it("allows approved → invalidated for system only", () => {
      expect(isValidTransition("approved", "invalidated", "system")).toBe(true);
    });

    it("rejects approved → invalidated for editor", () => {
      expect(isValidTransition("approved", "invalidated", "editor")).toBe(false);
    });

    it("rejects approved → invalidated for admin", () => {
      expect(isValidTransition("approved", "invalidated", "admin")).toBe(false);
    });
  });

  describe("invalidated transitions", () => {
    it("rejects all outgoing transitions from invalidated", () => {
      const allStatuses: ObservationStatus[] = ["candidate", "approved", "rejected", "superseded", "invalidated"];
      const allRoles: TransitionRole[] = ["admin", "editor", "viewer", "system"];

      for (const to of allStatuses) {
        for (const role of allRoles) {
          expect(isValidTransition("invalidated", to, role)).toBe(false);
        }
      }
    });
  });

  describe("same status", () => {
    it("rejects transitions to the same status", () => {
      const allStatuses: ObservationStatus[] = ["candidate", "approved", "rejected", "superseded", "invalidated"];
      for (const status of allStatuses) {
        expect(isValidTransition(status, status, "admin")).toBe(false);
      }
    });
  });
});
