// Shape returned by server actions to client forms. `code` is a key of
// Dictionary["results"], so every outcome has a translated message.

export type ResultCode =
  | "done"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "expired"
  | "email_mismatch"
  | "consent_required"
  | "invalid_media"
  | "second_admin_required"
  | "feature_not_enabled"
  | "too_early"
  | "access_inactive"
  | "limit_exceeded"
  | "error";

export type ActionResult<T = void> =
  | { status: "idle" }
  | { status: "ok"; data?: T }
  | { status: "error"; code: ResultCode };

export const IDLE: ActionResult<never> = { status: "idle" };
