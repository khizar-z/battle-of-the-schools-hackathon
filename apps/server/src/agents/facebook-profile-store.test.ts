import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FacebookProfileStore } from "./facebook-profile-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FacebookProfileStore", () => {
  it("persists only Steel's opaque profile ID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gehackathon-facebook-profile-"));
    temporaryDirectories.push(directory);
    const profilePath = join(directory, "profile.json");
    const store = new FacebookProfileStore(profilePath);

    await store.save("profile_opaque_123");

    expect(await store.load()).toBe("profile_opaque_123");
    expect(JSON.parse(await readFile(profilePath, "utf8"))).toEqual({ facebookProfileId: "profile_opaque_123" });
  });
});
