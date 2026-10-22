import { z } from "zod";
import { profileSchema, type Profile } from "./profile";
export interface SettingsStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export class ProfileRepository {
  constructor(
    private settings: SettingsStore,
    private secrets: SecretStore,
  ) {}
  async initialize() {
    if (this.settings.get<number>("connectionSchema", 0) === 2) return;
    for (const profile of this.settings.get<{ id?: string }[]>(
      "connections",
      [],
    ))
      if (profile.id) await this.secrets.delete(this.secretKey(profile.id));
    await this.settings.update("connections", []);
    await this.settings.update("activeConnection", undefined);
    await this.settings.update("connectionSchema", 2);
  }
  profiles(): Profile[] {
    return z.array(profileSchema).parse(this.settings.get("connections", []));
  }
  active(): Profile | undefined {
    return this.profiles().find(
      (profile) =>
        profile.id ===
        this.settings.get<string | undefined>("activeConnection", undefined),
    );
  }
  async select(profile: Profile) {
    await this.settings.update("activeConnection", profile.id);
  }
  async password(profile: Profile) {
    return this.secrets.get(this.secretKey(profile.id));
  }
  async save(profile: Profile, password: string) {
    const checked = profileSchema.parse(profile);
    await this.secrets.store(this.secretKey(checked.id), password);
    await this.settings.update("connections", [
      ...this.profiles().filter((profile) => profile.id !== checked.id),
      checked,
    ]);
    await this.select(checked);
  }
  async remove(profile: Profile) {
    await this.settings.update(
      "connections",
      this.profiles().filter((item) => item.id !== profile.id),
    );
    await this.secrets.delete(this.secretKey(profile.id));
    if (this.settings.get("activeConnection", "") === profile.id)
      await this.settings.update("activeConnection", undefined);
  }
  private secretKey(id: string) {
    return "dbtuna.password." + id;
  }
}
