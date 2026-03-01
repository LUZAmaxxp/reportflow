/**
 * Single source of truth for observation status transition rules.
 * Shared by API routes and transactional transition helper to avoid rule drift.
 */

export type ObservationStatus = "candidate" | "approved" | "rejected" | "superseded" | "invalidated";
export type TransitionRole = "admin" | "editor" | "viewer" | "system";

interface TransitionRule {
  from: ObservationStatus;
  to: ObservationStatus;
  allowedRoles: TransitionRole[];
}

const TRANSITION_RULES: TransitionRule[] = [
  { from: "candidate", to: "approved", allowedRoles: ["editor", "admin", "system"] },
  { from: "candidate", to: "rejected", allowedRoles: ["editor", "admin", "system"] },
  { from: "rejected", to: "candidate", allowedRoles: ["editor", "admin", "system"] },
  { from: "superseded", to: "approved", allowedRoles: ["editor", "admin", "system"] },
  { from: "approved", to: "invalidated", allowedRoles: ["system"] },
];

/**
 * isValidTransition checks whether a given status change is allowed for the specified role.
 *
 * Returns false for all other combinations, including any outgoing transition from invalidated.
 */
export function isValidTransition(
  from: ObservationStatus,
  to: ObservationStatus,
  role: TransitionRole
): boolean {
  // No outgoing transitions from invalidated
  if (from === "invalidated") return false;

  // Same status is not a valid "transition"
  if (from === to) return false;

  return TRANSITION_RULES.some(
    (rule) =>
      rule.from === from &&
      rule.to === to &&
      rule.allowedRoles.includes(role)
  );
}
