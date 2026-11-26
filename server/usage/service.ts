import { join } from "node:path";
import { z } from "zod";
import type { KeeperRefreshResult } from "../../shared/contracts";
import { snapshotSchema } from "../../shared/types";
import type { Account, KeeperInstance, QuotaWindow, SourceSnapshot } from "../../shared/types";
import { readDocument, writeDocument, type InstanceDraft, type SettingsStore, type StoredInstance } from "../storage/store";

const cacheEntry = z.object({ identity: z.string(), snapshot: snapshotSchema });
const cacheSchema = z.record(z.string(), cacheEntry);
const cacheFile = "snapshot-v2.json";
const CLAUDE = "claude-passive";

function empty(sourceId: string, kind: SourceSnapshot["kind"], label: string): SourceSnapshot {
  return { sourceId, kind, label, accounts: [], lastAttemptAt: null, lastSuccessAt: null };
}

type KeeperClient = {
  test(): Promise<number>;
  read(): Promise<Account[]>;
  requestRefresh(): Promise<KeeperRefreshResult>;
};

type Connect = (instance: KeeperInstance, password: string, signal: AbortSignal) => KeeperClient;
type Session = {
  abort: AbortController;
  client: KeeperClient;
  reading?: Promise<SourceSnapshot>;
  refreshing?: Promise<KeeperRefreshResult>;
};

export class UsageService {
  private cache: z.infer<typeof cacheSchema>;
  private sessions = new Map<string, Session>();
  private draftTests = new Map<AbortController, StoredInstance | undefined>();

  constructor(readonly store: SettingsStore, private connect: Connect, private now: () => Date = () => new Date()) {
    const saved = readDocument(join(store.directory, cacheFile), cacheSchema);
    if (saved) {
      this.cache = saved;
    } else {
      const legacy = readDocument(join(store.directory, "snapshot.json"), z.object({ [CLAUDE]: cacheEntry.optional() }));
      const entry = legacy?.[CLAUDE];
      this.cache = entry?.snapshot.kind === "claude" && entry.identity === store.claude.providerId
        ? { [CLAUDE]: entry } : {};
      if (legacy) this.persist();
    }
    this.prune();
  }

  private persist() { writeDocument(this.store.directory, cacheFile, this.cache); }

  prune() {
    const identities = new Map(this.store.instances.map(item => [item.id, item.binding]));
    const active = new Set(identities.values());
    for (const [binding, session] of this.sessions) {
      if (!active.has(binding)) {
        session.abort.abort();
        this.sessions.delete(binding);
      }
    }
    for (const [abort, previous] of this.draftTests) {
      if (previous && !active.has(previous.binding)) abort.abort();
    }
    identities.set(CLAUDE, this.store.claude.providerId);
    let changed = false;
    for (const [id, entry] of Object.entries(this.cache)) {
      if (entry.identity !== identities.get(id)) { delete this.cache[id]; changed = true; }
    }
    if (changed) this.persist();
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

  claudeSnapshot() {
    const label = `Claude Code · ${this.store.claude.providerId}`;
    const cached = this.cache[CLAUDE];
    if (cached?.identity === this.store.claude.providerId && cached.snapshot.accounts.length) return cached.snapshot;
    const snapshot = empty(CLAUDE, "claude", label);
    snapshot.accounts.push({ id: `claude:${this.store.claude.providerId}`, label, enabled: null, state: "unknown", windows: [], observedAt: null });
    return snapshot;
  }

  ingest(windows: QuotaWindow[], observedAt: string) {
    if (!this.store.claude.enabled || !windows.length) return;
    const snapshot = this.claudeSnapshot();
    const previous = snapshot.accounts[0];
    if (previous.observedAt && Date.parse(observedAt) < Date.parse(previous.observedAt)) return;
    const merged = new Map(previous.windows.map(window => [window.id, window]));
    for (const window of windows) merged.set(window.id, window);
    const latest = [...merged.values()];
    const account: Account = { ...previous, observedAt, windows: latest,
      state: latest.some(window => window.usedPercent === 100 || window.status === "rejected") ? "exhausted" : "available" };
    this.cache[CLAUDE] = { identity: this.store.claude.providerId, snapshot: {
      ...snapshot, accounts: [account], lastAttemptAt: observedAt, lastSuccessAt: observedAt,
    } };
    this.persist();
  }

  keeperSnapshot(instance: StoredInstance, reload = false): Promise<SourceSnapshot> {
    const pending = this.sessions.get(instance.binding)?.reading;
    if (pending) return pending;
    const entry = this.cache[instance.id];
    const previous = entry?.identity === instance.binding ? { ...entry.snapshot, label: instance.label }
      : empty(instance.id, "cpa", instance.label);
    if (!reload && previous.lastAttemptAt && this.now().getTime() - Date.parse(previous.lastAttemptAt) < 300_000) {
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
    session.refreshing = session.client.requestRefresh().then(result => {
      if (!this.isCurrent(instance) || session.abort.signal.aborted) throw new Error("Keeper 实例设置已变更。");
      return result;
    }).finally(() => { session.refreshing = undefined; });
    return session.refreshing;
  }

  isCurrent(instance: StoredInstance) {
    return this.store.instances.some(item => item.id === instance.id && item.binding === instance.binding);
  }

  async keeperSources(reload = false) {
    const requested = this.store.instances;
    const sources = await Promise.all(requested.map(instance => this.keeperSnapshot(instance, reload)));
    return sources.filter((_, index) => this.isCurrent(requested[index]));
  }

  async overview(reload = false) {
    const valid = await this.keeperSources(reload);
    if (this.store.claude.enabled) valid.push(this.claudeSnapshot());
    return valid;
  }

  private async read(instance: StoredInstance, session: Session, previous: SourceSnapshot) {
    const lastAttemptAt = this.now().toISOString();
    let next: SourceSnapshot;
    try {
      const accounts = await session.client.read();
      const oldAccounts = new Map(previous.accounts.map(account => [account.id, account]));
      const merged = accounts.map(account => {
        const old = oldAccounts.get(account.id);
        return !account.observedAt && old && (account.error || account.enabled === false)
          ? { ...account, windows: old.windows, observedAt: old.observedAt } : account;
      });
      const newest = accounts.flatMap(account => account.observedAt ? [account.observedAt] : []).sort().at(-1);
      next = { ...empty(instance.id, "cpa", instance.label), accounts: merged, lastAttemptAt,
        lastSuccessAt: newest ?? previous.lastSuccessAt };
    } catch (error) {
      next = { ...previous, lastAttemptAt, error: error instanceof Error ? error.message : "Keeper 读取失败。" };
    }
    const current = this.store.instances.find(item => item.id === instance.id);
    if (current?.binding === instance.binding && !session.abort.signal.aborted) {
      next.label = current.label;
      this.cache[instance.id] = { identity: instance.binding, snapshot: next };
      this.persist();
    }
    return next;
  }
}
