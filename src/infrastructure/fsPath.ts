import path from "node:path";

/**
 * Platform-correct path flavor for filesystem-level (node:fs) paths. Vault
 * logical paths should stay POSIX-style; this is only for absolute OS paths.
 */
export const fsPath = process.platform === "win32" ? path.win32 : path.posix;
