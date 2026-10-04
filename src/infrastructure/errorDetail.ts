/** Presentation cap for a failure snippet carried into a user-facing message. */
export const MAX_DETAIL_LENGTH = 200;

const SECRET_SPANS =
  /\b(?:sk|oc_sk|bearer|api[_-]?key|token|secret|password|credential)[^\s，。；,;]{0,80}/gi;

/**
 * One line of failure detail, with secret-looking spans dropped and long
 * reasons truncated. Returns "" when the error carries no usable message, so
 * callers can decide whether to keep their own wording.
 */
export function failureDetail(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const redacted = message.replace(SECRET_SPANS, "[redacted]").replace(/\s+/g, " ").trim();
  if (redacted === "") return "";
  return redacted.length > MAX_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : redacted;
}

/**
 * Message for a failed user-facing action: the caller's title, plus the reason
 * when there is one. A user must never have to open DevTools to learn why a
 * report or a summary did not run.
 */
export function describeFailure(title: string, error: unknown): string {
  const detail = failureDetail(error);
  return detail === "" ? title : `${title}（原因：${detail}）`;
}
