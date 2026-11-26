import type { ProviderKind } from "../../shared/providers";
import type { SourceSnapshot } from "../../shared/types";

export type UsageTarget = {
  id: string;
  binding: string;
  current(): boolean;
  read(refresh?: boolean): SourceSnapshot | Promise<SourceSnapshot>;
};

export type UsageSource = {
  kind: ProviderKind;
  registrationId: string;
  targets(): UsageTarget[];
};

export async function readTargets(targets: UsageTarget[], refresh = false) {
  const readings = await Promise.all(targets.map(async target => ({
    target, snapshot: await target.read(refresh),
  })));
  return readings.filter(({ target }) => target.current());
}
