import { KeeperRefreshBatch } from "./keeper-refresh";
import type { KeeperSubmission, TaskStatus } from "../sources/keeper";
import type { KeeperRefreshResult, KeeperRefreshStatus } from "../../shared/contracts";
import type { Account, KeeperInstance, SourceSnapshot } from "../../shared/types";
import { emptySnapshot, type SnapshotCache } from "../storage/snapshots";
import type { InstanceDraft, SettingsStore, StoredInstance } from "../storage/store";
import type { UsageSource, UsageTarget } from "./source";

type KeeperClient = {
  test(): Promise<number>;
  read(): Promise<Account[]>;
  requestRefresh(): Promise<KeeperSubmission>;
  taskStatus(index: string): Promise<TaskStatus>;
};

export type Connect = (instance: KeeperInstance, password: string, signal: AbortSignal) => KeeperClient;
type Session = {
  abort: AbortController;
  client: KeeperClient;
  reading?: Promise<SourceSnapshot>;
  refreshing?: Promise<KeeperRefreshResult>;
  batch?: KeeperRefreshBatch;
};

export class KeeperUsage implements UsageSource {
  readonly kind = "cpa";
  readonly registrationId = "keeper-codex-quota";
  private sessions = new Map<string, Session>();
  private draftTests = new Map<AbortController, StoredInstance | undefined>();

  constructor(private store: SettingsStore, private cache: SnapshotCache, private connect: Connect, private now: () => Date) {}

  targets(): UsageTarget[] {
    return this.store.instances.map(instance => ({
      id: instance.id, binding: instance.binding,
      current: () => this.isCurrent(instance),
      read: refresh => this.snapshot(instance, refresh),
    }));
  }

  prune() {
    const active = new Set(this.store.instances.map(item => item.binding));
    for (const [binding, session] of this.sessions) {
      if (!active.has(binding)) {
        session.abort.abort();
        this.sessions.delete(binding);
      }
    }
    for (const [abort, previous] of this.draftTests) {
      if (previous && !active.has(previous.binding)) abort.abort();
    }
  }

  dispose() {
    for (const session of this.sessions.values()) session.abort.abort();
    this.sessions.clear();
    for (const abort of this.draftTests.keys()) abort.abort();
    this.draftTests.clear();
  }

  private sessionFor(instance: StoredInstance): Session {
    const existing = this.sessions.get(instance.binding);
    if (existing) return existing;
    const abort = new AbortController();
    const session = { abort, client: this.connect(instance, this.store.password(instance), abort.signal) };
    this.sessions.set(instance.binding, session);
    return session;
  }

  snapshot(instance: StoredInstance, reload = false): Promise<SourceSnapshot> {
    const pending = this.sessions.get(instance.binding)?.reading;
    if (pending) return pending;
    const saved = this.cache.get(instance.id, instance.binding);
    const previous = { ...(saved ?? emptySnapshot(this.kind, instance.id)), instanceLabel: instance.label };
    if (!reload && previous.lastAttemptAt && this.now().getTime() - Date.parse(previous.lastAttemptAt) < 60_000) {
      return Promise.resolve(previous);
    }
    const session = this.sessionFor(instance);
    session.reading = this.read(instance, session, previous).finally(() => { session.reading = undefined; });
    return session.reading;
  }

  async testInstance(draft: InstanceDraft) {
    const { previous, instance, password } = this.store.resolve(draft);
    const saved = previous?.baseUrl === instance.baseUrl && this.store.password(previous) === password
      ? this.sessionFor(previous) : undefined;
    const abort = saved?.abort ?? new AbortController();
    if (!saved) this.draftTests.set(abort, previous);
    try {
      const client = saved?.client ?? this.connect(instance, password, abort.signal);
      const count = await client.test();
      if (abort.signal.aborted || (previous && !this.isCurrent(previous))) throw new Error("Keeper 实例设置已变更。");
      return count;
    } finally {
      if (!saved) this.draftTests.delete(abort);
    }
  }

  requestRefresh(id: string): Promise<KeeperRefreshResult> {
    const instance = this.store.instances.find(item => item.id === id);
    if (!instance) throw new Error("Keeper 实例已移除。");
    const session = this.sessionFor(instance);
    if (session.refreshing) return session.refreshing;
    if (session.batch?.pending) return Promise.resolve(session.batch.receipt);
    session.refreshing = session.client.requestRefresh().then(result => {
      if (!this.isCurrent(instance) || session.abort.signal.aborted) throw new Error("Keeper 实例设置已变更。");
      session.batch = new KeeperRefreshBatch(result, index => session.client.taskStatus(index), async () => {
        // An earlier read may still be returning the pre-refresh cache.
        await session.reading;
        if (!this.isCurrent(instance) || session.abort.signal.aborted) throw new Error("Keeper 实例设置已变更。");
        return (await this.snapshot(instance, true)).error;
      });
      return session.batch.receipt;
    }).finally(() => { session.refreshing = undefined; });
    return session.refreshing;
  }

  refreshStatus(id: string): KeeperRefreshStatus {
    const instance = this.store.instances.find(item => item.id === id);
    const batch = instance && this.sessions.get(instance.binding)?.batch;
    return batch?.status() ?? { phase: "idle", completed: 0, failed: 0, remaining: 0 };
  }

  private isCurrent(instance: StoredInstance) {
    return this.store.instances.some(item => item.id === instance.id && item.binding === instance.binding);
  }

  private async read(instance: StoredInstance, session: Session, previous: SourceSnapshot) {
    const lastAttemptAt = this.now().toISOString();
    let next: SourceSnapshot;
    try {
      const accounts = await session.client.read();
      const oldAccounts = new Map(previous.accounts.map(account => [account.id, account]));
      const merged = accounts.map(account => {
        const old = oldAccounts.get(account.id);
        return !account.observedAt && old?.observedAt
          ? { ...account, windows: old.windows, observedAt: old.observedAt } : account;
      });
      const newest = accounts.flatMap(account => account.observedAt ? [account.observedAt] : []).sort().at(-1);
      next = { ...emptySnapshot(this.kind, instance.id), instanceLabel: instance.label, accounts: merged, lastAttemptAt,
        lastSuccessAt: newest ?? previous.lastSuccessAt };
    } catch (error) {
      next = { ...previous, lastAttemptAt, error: error instanceof Error ? error.message : "Keeper 读取失败。" };
    }
    const current = this.store.instances.find(item => item.id === instance.id);
    if (current?.binding === instance.binding && !session.abort.signal.aborted) {
      next.instanceLabel = current.label;
      this.cache.save(instance.binding, next);
    }
    return next;
  }
}
