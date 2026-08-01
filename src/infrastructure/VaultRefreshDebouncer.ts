import { LOCAL_REFRESH_DEBOUNCE_MS } from "../constants";

interface VaultPathEvent {
  path: string;
  extension?: string;
}

export function isMarkdownVaultEvent(event: VaultPathEvent): boolean {
  return event.extension?.toLowerCase() === "md" || event.path.toLowerCase().endsWith(".md");
}

export function shouldRefreshForRename(event: VaultPathEvent, oldPath: string): boolean {
  return isMarkdownVaultEvent(event) || oldPath.toLowerCase().endsWith(".md");
}

export class VaultRefreshDebouncer {
  private timer: number | null = null;

  constructor(
    private readonly refresh: () => void,
    private readonly delayMs = LOCAL_REFRESH_DEBOUNCE_MS,
  ) {}

  trigger(): void {
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }
}
