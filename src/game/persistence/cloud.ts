import type { ToyBridgeClient } from "../platform/toyBridge";

export interface CloudKV {
  getItems(keys: readonly string[]): Promise<Readonly<Record<string, string>> | null>;
  setItems(items: Readonly<Record<string, string>>): Promise<boolean | void>;
  removeItems?(keys: readonly string[]): Promise<boolean | void>;
}

/** Adapts the failure-contained Toy bridge to the persistence cloud interface. */
export class ToyBridgeCloudKV implements CloudKV {
  constructor(private readonly client: ToyBridgeClient) {}

  async getItems(keys: readonly string[]): Promise<Readonly<Record<string, string>> | null> {
    const result = await this.client.getCloudStorage(keys);
    return result.ok ? result.value : null;
  }

  async setItems(items: Readonly<Record<string, string>>): Promise<boolean> {
    const result = await this.client.setCloudStorage(items);
    return result.ok;
  }

  async removeItems(keys: readonly string[]): Promise<boolean> {
    const tombstones: Record<string, string> = {};
    for (const key of keys) tombstones[key] = "";
    return await this.setItems(tombstones);
  }
}
