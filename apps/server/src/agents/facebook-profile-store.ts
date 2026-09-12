import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_PROFILE_PATH = "data/facebook-marketplace-profile.json";

interface StoredFacebookProfile {
  facebookProfileId: string;
}

/**
 * Stores only Steel's opaque profile ID. Facebook passwords, cookies, MFA
 * values, and login form data must never be written by this application.
 */
export class FacebookProfileStore {
  private readonly profilePath: string;

  constructor(profilePath = process.env.STEEL_FACEBOOK_PROFILE_FILE ?? DEFAULT_PROFILE_PATH) {
    this.profilePath = profilePath;
  }

  async load(): Promise<string | undefined> {
    if (process.env.STEEL_FACEBOOK_PROFILE_ID) return process.env.STEEL_FACEBOOK_PROFILE_ID;

    try {
      const parsed = JSON.parse(await readFile(this.profilePath, "utf8")) as Partial<StoredFacebookProfile>;
      return typeof parsed.facebookProfileId === "string" && parsed.facebookProfileId.length > 0
        ? parsed.facebookProfileId
        : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(`Could not read the Facebook Steel profile: ${errorMessage(error)}`);
    }
  }

  async save(profileId: string): Promise<void> {
    if (!profileId) throw new Error("Cannot save an empty Facebook Steel profile ID.");
    if (process.env.STEEL_FACEBOOK_PROFILE_ID) return;

    await mkdir(dirname(this.profilePath), { recursive: true });
    const temporaryPath = `${this.profilePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ facebookProfileId: profileId }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.profilePath);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown filesystem error";
}
