import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { claudeSchema, displaySchema, instanceSchema } from "../../shared/types";
import type { ClaudeSettings, CpaInstance, Display } from "../../shared/types";
import type { SettingsView } from "../../shared/contracts";

const configSchema = z.object({
  instances: z.array(instanceSchema.extend({ secretRef: z.string().nullable() })),
  claude: claudeSchema, display: displaySchema,
});
type Config = z.infer<typeof configSchema>;
export type StoredInstance = Config["instances"][number];
export type InstanceDraft = Omit<CpaInstance, "id"> & { id?: string; key?: string };

function defaults(): Config {
  return {
    instances: [], claude: { enabled: false, providerId: "claude" },
    display: { showDisabledAccounts: true, showNativeProviders: true, showResetCountdown: true },
  };
}

export function readDocument<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error("Provider Usage could not read its saved data.");
  }
}

// Adapted from Usage Monitor's owner-only atomicWrite (see THIRD_PARTY_NOTICES.md).
export function writeDocument(directory: string, name: string, document: unknown) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(document), { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, join(directory, name));
  } finally {
    rmSync(temporary, { force: true });
  }
}

function normalizeUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入有效的 CPA 管理地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("CPA 地址仅接受 HTTP(S) 服务路径，请移除用户名、密码和查询参数。");
  }
  return url.href.replace(/\/+$/, "");
}

export class SettingsStore {
  private config: Config;
  private secrets: Record<string, string>;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.config = readDocument(join(directory, "config.json"), configSchema, defaults());
    this.secrets = readDocument(join(directory, "secrets.json"), z.record(z.string(), z.string()), {});
    this.pruneSecrets();
  }

  get instances() { return this.config.instances; }
  get claude() { return this.config.claude; }
  get display() { return this.config.display; }

  key(instance: StoredInstance) {
    return instance.secretRef ? this.secrets[instance.secretRef] : undefined;
  }

  view(claudeObservedAt: string | null): SettingsView {
    return {
      instances: this.instances.map(({ id, label, baseUrl, secretRef }) => ({
        id, label, baseUrl, hasSecret: !!(secretRef && this.secrets[secretRef]),
      })),
      claude: this.claude, display: this.display, claudeObservedAt,
    };
  }

  resolve(draft: InstanceDraft) {
    const previous = this.instances.find(instance => instance.id === draft.id);
    if (draft.id && !previous) throw new Error("CPA 实例已移除。");
    const baseUrl = normalizeUrl(draft.baseUrl);
    const oldKey = previous && new URL(previous.baseUrl).origin === new URL(baseUrl).origin
      ? this.key(previous) : undefined;
    const key = draft.key?.trim() || oldKey;
    if (!key) throw new Error("请为此 CPA 地址输入管理密钥。");
    return { previous, instance: { id: previous?.id ?? randomUUID(), label: draft.label.trim(), baseUrl }, key };
  }

  save(draft: InstanceDraft) {
    const { previous, instance, key } = this.resolve(draft);
    let secretRef = previous?.secretRef;
    if (!secretRef || this.secrets[secretRef] !== key) {
      secretRef = randomUUID();
      this.writeSecrets({ ...this.secrets, [secretRef]: key });
    }
    const saved = { ...instance, secretRef };
    this.persist({ ...this.config, instances: previous
      ? this.instances.map(item => item.id === previous.id ? saved : item)
      : [...this.instances, saved] });
    this.pruneSecrets();
  }

  remove(id: string, clearKeyOnly = false) {
    const instances = clearKeyOnly
      ? this.instances.map(item => item.id === id ? { ...item, secretRef: null } : item)
      : this.instances.filter(item => item.id !== id);
    this.persist({ ...this.config, instances });
    this.pruneSecrets();
  }

  preferences(update: { display?: Partial<Display>; claude?: ClaudeSettings }) {
    this.persist({
      ...this.config, display: { ...this.display, ...update.display }, claude: update.claude ?? this.claude,
    });
  }

  private persist(config: Config) {
    writeDocument(this.directory, "config.json", config);
    this.config = config;
  }

  private writeSecrets(secrets: Record<string, string>) {
    writeDocument(this.directory, "secrets.json", secrets);
    this.secrets = secrets;
  }

  // A crash between the two renames leaves the committed config pointing to a valid key.
  private pruneSecrets() {
    const referenced = new Set(this.instances.map(instance => instance.secretRef));
    const kept = Object.entries(this.secrets).filter(([ref]) => referenced.has(ref));
    if (kept.length !== Object.keys(this.secrets).length) this.writeSecrets(Object.fromEntries(kept));
  }
}
