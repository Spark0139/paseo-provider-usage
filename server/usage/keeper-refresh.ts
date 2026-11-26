import type { KeeperRefreshResult, KeeperRefreshStatus } from "../../shared/contracts";
import { KeeperHttpError, type KeeperSubmission, type TaskStatus } from "../sources/keeper";

const intervalMs = 4_000;
const checkConcurrency = 4;

// A visible UI requests one bounded status pass. Keeper owns the queued work.
export class KeeperRefreshBatch {
  readonly receipt: KeeperRefreshResult;
  private progress: KeeperRefreshStatus;
  private waiting: string[];
  private missing = 0;
  private checking = false;
  private nextCheckAt = 0;
  private readonly expiresAt: number;

  constructor(
    { queued, pending, failed, indexes }: KeeperSubmission,
    private taskStatus: (index: string) => Promise<TaskStatus>,
    private reread: () => Promise<string | undefined>,
  ) {
    this.receipt = { queued, pending, failed };
    this.waiting = indexes;
    this.progress = { phase: indexes.length ? "pending" : "completed", completed: 0, failed, remaining: indexes.length };
    this.expiresAt = Date.now() + 15 * 60_000 + Math.ceil(indexes.length / checkConcurrency) * intervalMs;
  }

  get pending() { return this.progress.phase === "pending"; }

  status(): KeeperRefreshStatus {
    if (this.pending && !this.checking && Date.now() >= Math.min(this.nextCheckAt, this.expiresAt)) {
      this.checking = true;
      // Status RPCs return immediately even if Keeper takes its full request timeout.
      void this.check().catch(() => {
        this.progress = { ...this.progress, phase: "unconfirmed", error: "无法确认本次更新的结果。" };
      }).finally(() => { this.checking = false; });
    }
    return { ...this.progress };
  }

  private async check() {
    const batch = Date.now() < this.expiresAt ? this.waiting.splice(0, checkConcurrency) : [];
    const results = await Promise.allSettled(batch.map(index => this.taskStatus(index)));
    const progress = { ...this.progress };
    delete progress.error;
    this.nextCheckAt = Date.now() + intervalMs;
    let authenticationFailed = false;
    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        const error = result.reason;
        if (error instanceof KeeperHttpError && (error.status === 401 || error.status === 403)) {
          this.missing++;
          authenticationFailed = true;
        } else {
          this.waiting.push(batch[i]);
          this.nextCheckAt = Math.max(this.nextCheckAt, Date.now() + 12_000, error instanceof KeeperHttpError ? error.retryAt : 0);
        }
        progress.error = error instanceof Error ? error.message : "读取 Keeper 更新状态失败。";
      } else {
        switch (result.value) {
          case "completed": progress.completed++; break;
          case "failed": progress.failed++; break;
          case "missing": this.missing++; break;
          default: this.waiting.push(batch[i]);
        }
      }
    }
    if (authenticationFailed || Date.now() >= this.expiresAt) {
      this.missing += this.waiting.length;
      this.waiting = [];
    }
    progress.remaining = this.waiting.length + this.missing;
    if (!this.waiting.length) {
      if (this.missing && !progress.error) progress.error = "部分任务已过期或仍未确认。";
      const readError = await this.reread();
      if (readError) progress.error = readError;
      progress.phase = this.missing ? "unconfirmed" : "completed";
    }
    this.progress = progress;
  }
}
