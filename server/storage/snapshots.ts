import { join } from "node:path";
import { z } from "zod";
import { providers, type ProviderKind } from "../../shared/providers";
import { snapshotSchema, type SourceSnapshot } from "../../shared/types";
import { readDocument, writeDocument } from "./store";

const cacheSchema = z.record(z.string(), z.object({ identity: z.string(), snapshot: snapshotSchema }));
const cacheFile = "quota-cache.json";
type Entries = z.infer<typeof cacheSchema>;

export function emptySnapshot(kind: ProviderKind, sourceId: string): SourceSnapshot {
  return { kind, sourceId, label: providers[kind].label, accounts: [], lastAttemptAt: null, lastSuccessAt: null };
}

export class SnapshotCache {
  private entries: Entries;

  constructor(private directory: string) {
    this.entries = readDocument(join(directory, cacheFile), cacheSchema) ?? {};
  }

  get(id: string, identity: string) {
    const entry = this.entries[id];
    return entry?.identity === identity ? entry.snapshot : undefined;
  }

  save(identity: string, snapshot: SourceSnapshot) {
    this.persist({ ...this.entries, [snapshot.sourceId]: { identity, snapshot } });
  }

  retain(identities: Map<string, string>) {
    const entries = Object.entries(this.entries);
    const kept = entries.filter(([id, entry]) => identities.get(id) === entry.identity);
    if (kept.length < entries.length) this.persist(Object.fromEntries(kept));
  }

  private persist(entries: Entries) {
    writeDocument(this.directory, cacheFile, entries);
    this.entries = entries;
  }
}
