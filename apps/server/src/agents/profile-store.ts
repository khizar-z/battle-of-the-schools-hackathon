import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const profileRecordSchema = z.object({ sourceId: z.string().min(1), profileId: z.string().min(1) });

export interface SteelProfileStore {
  get(sourceId: string): Promise<string | undefined>;
  save(sourceId: string, profileId: string): Promise<void>;
}

export class InMemorySteelProfileStore implements SteelProfileStore {
  private readonly profiles = new Map<string, string>();

  async get(sourceId: string): Promise<string | undefined> {
    return this.profiles.get(sourceId);
  }

  async save(sourceId: string, profileId: string): Promise<void> {
    this.profiles.set(sourceId, profileId);
  }
}

export class FileSteelProfileStore implements SteelProfileStore {
  private readonly profiles = new Map<string, string>();
  private loaded = false;

  constructor(private readonly filePath = resolve(process.cwd(), "data/steel-profiles.json")) {}

  async get(sourceId: string): Promise<string | undefined> {
    await this.load();
    return this.profiles.get(sourceId);
  }

  async save(sourceId: string, profileId: string): Promise<void> {
    await this.load();
    this.profiles.set(sourceId, profileId);
    await mkdir(dirname(this.filePath), { recursive: true });
    const records = [...this.profiles.entries()].map(([storedSourceId, storedProfileId]) => ({ sourceId: storedSourceId, profileId: storedProfileId }));
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(records, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const records = z.array(profileRecordSchema).parse(JSON.parse(await readFile(this.filePath, "utf8")));
      for (const record of records) this.profiles.set(record.sourceId, record.profileId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function createSteelProfileStore(): SteelProfileStore {
  return new FileSteelProfileStore(process.env.STEEL_PROFILE_STORE_PATH || undefined);
}
