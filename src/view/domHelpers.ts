import type { ModuleState } from "../domain/types";

interface FallbackCopy {
  loading: string;
  empty: string;
  error: string;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  container: HTMLElement,
  tag: K,
): HTMLElementTagNameMap[K] {
  return container.ownerDocument.createElement(tag);
}

export function renderModuleFallback<T>(
  container: HTMLElement,
  state: ModuleState<T[] | T | null>,
  copy: FallbackCopy,
): boolean {
  let kind: "loading" | "empty" | "error" | null = null;
  let message = "";
  if (state.status === "loading" || state.status === "idle") {
    kind = "loading";
    message = state.message ?? copy.loading;
  } else if (state.status === "error") {
    kind = "error";
    message = state.message ?? copy.error;
  } else if (
    state.data === null ||
    (Array.isArray(state.data) && state.data.length === 0)
  ) {
    kind = "empty";
    message = state.message ?? copy.empty;
  }

  if (kind === null) return false;
  const status = createElement(container, "p");
  status.className = `ad-module-state ad-module-state--${kind}`;
  status.dataset.state = kind;
  status.textContent = message;
  container.append(status);
  if (kind === "loading") {
    const skeleton = createElement(container, "div");
    skeleton.className = "ad-skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    for (let bar = 0; bar < 3; bar += 1) {
      const line = createElement(container, "span");
      line.className = "ad-skeleton__bar";
      skeleton.append(line);
    }
    container.append(skeleton);
  }
  return true;
}

export function createSafeExternalLink(
  container: HTMLElement,
  rawUrl: string,
  label: string,
): HTMLAnchorElement | HTMLSpanElement {
  let safeUrl: URL | null = null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      safeUrl = parsed;
    }
  } catch {
    safeUrl = null;
  }

  if (safeUrl === null) {
    const fallback = createElement(container, "span");
    fallback.textContent = label;
    return fallback;
  }

  const link = createElement(container, "a");
  link.href = safeUrl.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}
