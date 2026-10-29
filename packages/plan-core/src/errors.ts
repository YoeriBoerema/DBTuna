// Only controlled application diagnostics may cross into UI/export messages.
export class UserFacingError extends Error {}

export function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof UserFacingError ? error.message : fallback;
}
