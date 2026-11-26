import type { QuotaWindow, SourceSnapshot } from "./types";

export type CatalogModel = NonNullable<SourceSnapshot["models"]>[number];
type Group = {
  name: string;
  shared: boolean;
  models: CatalogModel[];
  windows: { window: QuotaWindow; period: string; disabled: boolean }[];
};

const familyPool = (name: string) =>
  /^gemini$/i.test(name) ? "gemini" : /^claude (?:and|&) gpt$/i.test(name) ? "third-party" : null;

function sharedPoolFor(model: CatalogModel) {
  // The CLI documents Flash/Pro and the Claude/GPT pool. New Gemini variants can have a separate pool.
  if (/^gemini (?:[\d.]+ )?(?:flash|pro)$/i.test(model.label)) return "gemini";
  if (/^(claude|gpt)(?:\b|_)/i.test(model.label)) return "third-party";
  return null;
}

export function antigravityGroups(windows: QuotaWindow[], models: CatalogModel[] = []) {
  const groups = new Map<string, Group>();
  for (const window of windows) {
    // Paseo joins group, bucket name and the optional "Disabled" suffix with this delimiter.
    const parts = window.label.split(" · ");
    const disabled = parts.length > 1 && parts.at(-1) === "Disabled";
    if (disabled) parts.pop();
    const period = parts.pop()!;
    const name = parts.join(" · ");
    let group = groups.get(name);
    if (!group) {
      group = { name, shared: familyPool(name) !== null, models: [], windows: [] };
      groups.set(name, group);
    }
    group.windows.push({ window, period, disabled });
  }
  const ordered = [...groups.values()];
  const unlisted: CatalogModel[] = [];
  for (const model of models) {
    const label = model.label.toLowerCase();
    const id = model.id.toLowerCase();
    const exact = ordered.find(group => !group.shared &&
      [label, id].includes(group.name.toLowerCase()));
    const pool = sharedPoolFor(model);
    const shared = pool && ordered.find(group => familyPool(group.name) === pool);
    const group = exact || shared;
    if (group) group.models.push(model);
    else unlisted.push(model);
  }
  return { groups: ordered, unlisted };
}
