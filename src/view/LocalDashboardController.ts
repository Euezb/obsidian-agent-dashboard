import type { DashboardTask } from "../domain/types";
import type { LocalDashboardData } from "../features/vault/VaultScanner";

export interface LocalDashboardControllerOptions {
  scan: () => Promise<LocalDashboardData>;
  toggleTask: (task: DashboardTask) => Promise<void>;
  onReady: (data: LocalDashboardData, updatedAt: number) => void;
  onScanError: () => void;
  onToggleError: (error: unknown) => void;
  now: () => number;
}

export class LocalDashboardController {
  private openGeneration = 0;
  private requestRevision = 0;
  private isOpen = false;
  private readonly pendingTaskIds = new Set<string>();
  private readonly activeScans = new Set<Promise<void>>();

  constructor(private readonly options: LocalDashboardControllerOptions) {}

  open(): Promise<void> {
    this.isOpen = true;
    this.openGeneration += 1;
    return this.refresh();
  }

  close(): void {
    this.isOpen = false;
    this.openGeneration += 1;
    this.requestRevision += 1;
  }

  refresh(): Promise<void> {
    const generation = this.openGeneration;
    const revision = ++this.requestRevision;
    const operation = this.runScan(generation, revision);
    this.activeScans.add(operation);
    void operation.then(
      () => this.activeScans.delete(operation),
      () => this.activeScans.delete(operation),
    );
    return operation;
  }

  private async runScan(generation: number, revision: number): Promise<void> {
    try {
      const data = await this.options.scan();
      if (!this.isCurrent(generation, revision)) return;
      this.options.onReady(data, this.options.now());
    } catch {
      if (this.isCurrent(generation, revision)) this.options.onScanError();
    }
  }

  async toggle(task: DashboardTask): Promise<void> {
    if (this.pendingTaskIds.has(task.id)) return;
    this.pendingTaskIds.add(task.id);
    try {
      await this.options.toggleTask(task);
      this.requestRevision += 1;
      await Promise.allSettled([...this.activeScans]);
      if (!this.isOpen) return;
      await this.refresh();
    } catch (error) {
      if (this.isOpen) this.options.onToggleError(error);
    } finally {
      this.pendingTaskIds.delete(task.id);
    }
  }

  private isCurrent(generation: number, revision: number): boolean {
    return this.isOpen &&
      this.openGeneration === generation &&
      this.requestRevision === revision;
  }
}
