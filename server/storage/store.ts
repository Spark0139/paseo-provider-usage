import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { claudeSchema, displaySchema, instanceSchema } from "../../shared/types";
import type { ClaudeSettings, KeeperInstance, Display } from "../../shared/types";
import type { SettingsView } from "../../shared/contracts";

const configSchema = z.object({
  instances: z.array(instanceSchema.extend({ binding: z.string() })),
  claude: claudeSchema, display: displaySchema,
});
type Config = z.infer<typeof configSchema>;
export type StoredInstance = Config["instances"][number];
export type InstanceDraft = Omit<KeeperInstance, "id"> & { id?: string; password?: string };

const configFile = "config-v2.json";
const passwordFile = "keeper-passwords.json";

function defaults(): Config {
  return {
    instances: [], claude: { enabled: false, providerId: "claude" },
    display: { showDisabledAccounts: true, showNativeProviders: true, showResetCountdown: true },
  };
}

export function readDocument<T>(path: string, schema: z.ZodType<T>): T | undefined {
  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
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
  try { url = new URL(value); } catch { throw new Error("请输入有效的 Keeper 地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Keeper 地址仅接受 HTTP(S) 服务路径，请移除用户名、密码和查询参数。");
  }
  return url.href.replace(/\/+$/, "");
}

export class SettingsStore {
  private config: Config;
  private passwords: Record<string, string>;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.config = readDocument(join(directory, configFile), configSchema) ?? defaults();
    this.passwords = readDocument(join(directory, passwordFile), z.record(z.string(), z.string())) ?? {};
    this.prunePasswords();
  }

  get instances() { return this.config.instances; }
  get claude() { return this.config.claude; }
  get display() { return this.config.display; }

  password(instance: StoredInstance) { return this.passwords[instance.binding] ?? ""; }

  view(claudeObservedAt: string | null): SettingsView {
    return {
      instances: this.instances.map(({ id, label, baseUrl, binding }) => ({
        id, label, baseUrl, hasPassword: !!this.passwords[binding],
      })),
      claude: this.claude, display: this.display, claudeObservedAt,
    };
  }

  resolve(draft: InstanceDraft) {
    const previous = this.instances.find(instance => instance.id === draft.id);
    if (draft.id && !previous) throw new Error("Keeper 实例已移除。");
    const baseUrl = normalizeUrl(draft.baseUrl);
    const existing = previous?.baseUrl === baseUrl ? this.password(previous) : "";
    const password = draft.password || existing;
    const instance = { id: previous?.id ?? randomUUID(), label: draft.label.trim(), baseUrl };
    return { previous, instance, password };
  }

  save(draft: InstanceDraft) {
    const { previous, instance, password } = this.resolve(draft);
    const same = previous?.baseUrl === instance.baseUrl && this.password(previous) === password;
    const binding = same ? previous.binding : randomUUID();
    if (!same && password) this.writePasswords({ ...this.passwords, [binding]: password });
    const saved = { ...instance, binding };
    this.persist({ ...this.config, instances: previous
      ? this.instances.map(item => item.id === previous.id ? saved : item)
      : [...this.instances, saved] });
    this.prunePasswords();
  }

  remove(id: string) {
    this.persist({ ...this.config, instances: this.instances.filter(item => item.id !== id) });
    this.prunePasswords();
  }

  clearPassword(id: string) {
    const previous = this.instances.find(item => item.id === id);
    if (!previous || !this.password(previous)) return;
    const cleared = { ...previous, binding: randomUUID() };
    this.persist({ ...this.config, instances: this.instances.map(item => item.id === id ? cleared : item) });
    this.prunePasswords();
  }

  preferences(update: { display?: Partial<Display>; claude?: ClaudeSettings }) {
    this.persist({
      ...this.config, display: { ...this.display, ...update.display }, claude: update.claude ?? this.claude,
    });
  }

  private persist(config: Config) {
    writeDocument(this.directory, configFile, config);
    this.config = config;
  }

  private writePasswords(passwords: Record<string, string>) {
    writeDocument(this.directory, passwordFile, passwords);
    this.passwords = passwords;
  }

  private prunePasswords() {
    const referenced = new Set(this.instances.map(instance => instance.binding));
    const kept = Object.entries(this.passwords).filter(([id]) => referenced.has(id));
    if (kept.length !== Object.keys(this.passwords).length) this.writePasswords(Object.fromEntries(kept));
  }
}
