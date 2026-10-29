import { UserFacingError } from "../../../packages/plan-core/src/errors";

export function databaseError(error: unknown): UserFacingError {
  if (error instanceof UserFacingError) return error;
  const native = error && typeof error === "object" ? error : {};
  const code = "code" in native ? native.code : undefined;
  const number = "number" in native ? native.number : undefined;
  const oracle = "errorNum" in native ? native.errorNum : undefined;
  // Compare exact stable codes only. Native messages, causes, detail and hints
  // can contain SQL, account names or values and must never be displayed.
  if (
    typeof code === "string" &&
    ["57014", "ETIMEDOUT", "ETIMEOUT"].includes(code)
  )
    return new UserFacingError(
      "Database operation timed out or was cancelled.",
    );
  if (code === "42501" || number === 229 || oracle === 1031 || oracle === 942)
    return new UserFacingError(
      "Database permissions are insufficient. Check the connector setup guide.",
    );
  if (
    (typeof code === "string" && ["28P01", "28000"].includes(code)) ||
    number === 18456 ||
    oracle === 1017
  )
    return new UserFacingError(
      "Database authentication failed. Check your saved credentials.",
    );
  return new UserFacingError(
    "Database operation failed. Check SQL syntax, object names, connection settings and permissions.",
  );
}
