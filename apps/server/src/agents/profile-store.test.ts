import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileSteelProfileStore, InMemorySteelProfileStore } from "./profile-store.js";

describe("Steel profile store", () => {
  it("retains source-specific profile IDs in memory", async () => {
    const store = new InMemorySteelProfileStore();
    await store.save("facebook", "profile-facebook");

    await expect(store.get("facebook")).resolves.toBe("profile-facebook");
    await expect(store.get("kijiji")).resolves.toBeUndefined();
  });

  it("persists profile IDs for the next server process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scout-profiles-"));
    const filePath = join(directory, "profiles.json");
    const writer = new FileSteelProfileStore(filePath);
    await writer.save("facebook", "profile-facebook");

    const reader = new FileSteelProfileStore(filePath);
    await expect(reader.get("facebook")).resolves.toBe("profile-facebook");
  });
});
