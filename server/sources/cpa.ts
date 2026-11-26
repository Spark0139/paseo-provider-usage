import { createHash } from "node:crypto";
import { z } from "zod";
import type { Account, CpaInstance } from "../../shared/types";
import { readQuota } from "./cpa-windows";

// Request headers adapted from proxy-usage, src/lib/quota/providers/codex.ts (MIT).
const usageHeaders = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)",
};
const codexClaims = z.object({
  chatgpt_account_id: z.string().optional(),
  plan_type: z.string().optional(),
});
const credential = z.object({
  type: z.string().optional(),
  account_type: z.string().optional(),
  name: z.string().min(1),
  auth_index: z.string().optional(),
  disabled: z.boolean().optional(),
  id_token: codexClaims.catch({}).optional(),
});
const credentialList = z.object({ files: z.array(credential) });
const envelope = z.object({ status_code: z.number().int(), body: z.string() });

type Credential = z.infer<typeof credential>;
type Options = { fetch?: typeof fetch; now?: () => Date };
class CpaError extends Error {}

function createClient(instance: CpaInstance, key: string, options: Options) {
  // The settings service validates the base URL. Keep a reverse proxy's path prefix.
  const base = instance.baseUrl.replace(/\/+$/, "") + "/v8/management";
  const send = options.fetch ?? fetch;
  return async (path: "/credentials" | "/requests/api-call", body?: object): Promise<unknown> => {
    if (!key) throw new CpaError("CPA management key is missing.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await send(base + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, ...(body && { "Content-Type": "application/json" }) },
        body: body ? JSON.stringify(body) : undefined,
        // Inspect redirects as non-2xx without sending the management key to another URL.
        redirect: "manual", signal: controller.signal,
      });
      if (!response.ok) throw new CpaError(`CPA management request failed (HTTP ${response.status}).`);
      return await response.json();
    } catch (error) {
      if (error instanceof CpaError) throw error;
      throw new CpaError(controller.signal.aborted ? "CPA request timed out." : "Could not read the CPA management response.");
    } finally {
      clearTimeout(timeout);
    }
  };
}
type Client = ReturnType<typeof createClient>;

async function discover(client: Client): Promise<Credential[]> {
  const result = credentialList.safeParse(await client("/credentials"));
  if (!result.success) throw new CpaError("Invalid CPA credential list.");
  const codex = result.data.files.filter(file => file.type === "codex");
  // CPA's disk-only listing omits account_type. It cannot identify the OAuth pool.
  if (codex.length && codex.every(file => !file.account_type)) {
    throw new CpaError("CPA did not report credential types for its Codex accounts.");
  }
  return codex.filter(file => file.account_type === "oauth");
}

export async function testCpa(instance: CpaInstance, key: string, options: Options = {}): Promise<number> {
  return (await discover(createClient(instance, key, options))).length;
}

async function readAccount(file: Credential, client: Client, now: () => Date): Promise<Account> {
  const accountId = file.id_token?.chatgpt_account_id;
  const enabled = typeof file.disabled === "boolean" ? !file.disabled : null;
  // CPA derives auth_index from the file, which can later hold a different login.
  const identity = JSON.stringify([file.auth_index ?? file.name, accountId ?? null]);
  const account: Account = {
    id: createHash("sha256").update(identity).digest("hex"),
    label: file.name,
    enabled,
    state: enabled === false ? "disabled" : "unknown",
    planLabel: file.id_token?.plan_type,
    windows: [],
    observedAt: null,
  };
  if (enabled !== true) return account;
  if (!file.auth_index) {
    return { ...account, state: "unavailable", error: "CPA did not provide an auth_index." };
  }
  try {
    const result = envelope.safeParse(await client("/requests/api-call", {
      auth_index: file.auth_index,
      method: "GET", url: "https://chatgpt.com/backend-api/wham/usage",
      header: { ...usageHeaders, ...(accountId && { "Chatgpt-Account-Id": accountId }) },
    }));
    if (!result.success) throw new CpaError("Invalid CPA forwarded response.");
    const { status_code, body } = result.data;
    if (status_code < 200 || status_code >= 300) throw new CpaError(`Codex quota request failed (HTTP ${status_code}).`);
    const observed = now();
    const quota = readQuota(JSON.parse(body), observed);
    if (!quota) return { ...account, error: "Codex returned no usable quota data." };
    return { ...account, ...quota, planLabel: quota.planLabel ?? account.planLabel, observedAt: observed.toISOString() };
  } catch (error) {
    // Remote error bodies can contain credentials. Return only our own short messages.
    return {
      ...account,
      state: "unavailable",
      error: error instanceof CpaError ? error.message : "Invalid Codex quota response.",
    };
  }
}

export async function pullCpa(instance: CpaInstance, key: string, options: Options = {}): Promise<Account[]> {
  const client = createClient(instance, key, options);
  const files = await discover(client);
  const now = options.now ?? (() => new Date());
  const accounts = new Array<Account>(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      accounts[index] = await readAccount(files[index], client, now);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  return accounts;
}
