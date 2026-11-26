import { SnapshotCache } from "../storage/snapshots";
import type { SettingsStore } from "../storage/store";
import { ClaudeUsage } from "./claude";
import { KeeperUsage, type Connect } from "./keeper";
import { readTargets, type UsageSource } from "./source";

export class UsageService {
  readonly keeper: KeeperUsage;
  readonly claude: ClaudeUsage;
  readonly sources: readonly UsageSource[];
  private cache: SnapshotCache;

  constructor(private store: SettingsStore, connect: Connect, now: () => Date = () => new Date()) {
    this.cache = new SnapshotCache(store.directory);
    this.keeper = new KeeperUsage(store, this.cache, connect, now);
    this.claude = new ClaudeUsage(store, this.cache);
    this.sources = [this.keeper, this.claude];
    this.prune();
  }

  prune() {
    this.keeper.prune();
    const identities = new Map(this.store.instances.map(item => [item.id, item.binding]));
    identities.set(this.claude.sourceId, this.claude.binding);
    this.cache.retain(identities);
  }

  async overview(refresh = false) {
    const readings = await readTargets(this.sources.flatMap(source => source.targets()), refresh);
    return readings.map(reading => reading.snapshot);
  }
}
