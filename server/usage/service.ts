import { join } from "node:path";
import { z } from "zod";
import { snapshotSchema } from "../../shared/types";
import type { Account, CpaInstance, QuotaWindow, SourceSnapshot } from "../../shared/types";
import { readDocument, writeDocument, type SettingsStore, type StoredInstance } from "../storage/store";

const cacheSchema = z.record(z.string(), z.object({ identity: z.string(), snapshot: snapshotSchema }));
const CLAUDE = "claude-passive";

export function cpaIdentity(instance: StoredInstance) {
  return JSON.stringify([instance.baseUrl, instance.secretRef]);
}

function empty(sourceId: string, kind: SourceSnapshot["kind"], label: string): SourceSnapshot {
  return { sourceId, kind, label, accounts: [], lastAttemptAt: null, lastSuccessAt: null };
}

type Pull = (instance: CpaInstance, key: string) => Promise<Account[]>;

export class UsageService {
  private cache: z.infer<typeof cacheSchema>;
  private pending = new Map<string, Promise<SourceSnapshot>>();

  constructor(readonly store: SettingsStore, private pull: Pull, private now: () => Date = () => new Date()) {
    this.cache = readDocument(join(store.directory, "snapshot.json"), cacheSchema, {});
    this.prune();
  }

  private persist() { writeDocument(this.store.directory, "snapshot.json", this.cache); }

  prune() {
    const identities = new Map(this.store.instances.map(item => [item.id, cpaIdentity(item)]));
    identities.set(CLAUDE, this.store.claude.providerId);
    let changed = false;
    for (const [id, entry] of Object.entries(this.cache)) {
      if (entry.identity !== identities.get(id)) { delete this.cache[id]; changed = true; }
    }
    if (changed) this.persist();
  }

  claudeSnapshot() {
    const label = `Claude Code · ${this.store.claude.providerId}`;
    const cached = this.cache[CLAUDE];
    if (cached?.identity === this.store.claude.providerId) return cached.snapshot;
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

  cpaSnapshot(instance: StoredInstance, refresh = false): Promise<SourceSnapshot> {
    const binding = cpaIdentity(instance);
    const taskId = JSON.stringify([instance.id, binding]);
    const active = this.pending.get(taskId);
    if (active) return active;
    const entry = this.cache[instance.id];
    const previous = entry?.identity === binding ? { ...entry.snapshot, label: instance.label }
      : empty(instance.id, "cpa", instance.label);
    const windowMs = refresh ? 60_000 : 300_000;
    if (previous.lastAttemptAt && this.now().getTime() - Date.parse(previous.lastAttemptAt) < windowMs) {
      return Promise.resolve(previous);
    }
    const job = this.refresh(instance, previous).finally(() => this.pending.delete(taskId));
    this.pending.set(taskId, job);
    return job;
  }

  isCurrent(instance: StoredInstance) {
    return this.store.instances.some(item => item.id === instance.id && cpaIdentity(item) === cpaIdentity(instance));
  }

  async cpaSources(refresh = false) {
    const requested = this.store.instances;
    const sources = await Promise.all(requested.map(instance => this.cpaSnapshot(instance, refresh)));
    // A settings change may remove or rebind an instance while its request is in flight.
    return sources.filter((_, index) => this.isCurrent(requested[index]));
  }

  async overview(refresh = false) {
    const valid = await this.cpaSources(refresh);
    if (this.store.claude.enabled) valid.push(this.claudeSnapshot());
    return valid;
  }

  private async refresh(instance: StoredInstance, previous: SourceSnapshot) {
    const lastAttemptAt = this.now().toISOString();
    let next: SourceSnapshot;
    try {
      const key = this.store.key(instance);
      if (!key) throw new Error("尚未配置 CPA 管理密钥。");
      const accounts = await this.pull(instance, key);
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
      next = { ...previous, lastAttemptAt, error: error instanceof Error ? error.message : "CPA 查询失败。" };
    }
    const current = this.store.instances.find(item => item.id === instance.id);
    if (current && cpaIdentity(current) === cpaIdentity(instance)) {
      next.label = current.label;
      this.cache[instance.id] = { identity: cpaIdentity(instance), snapshot: next };
      this.persist();
    }
    return next;
  }
}
