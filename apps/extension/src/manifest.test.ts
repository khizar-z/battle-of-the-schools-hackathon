import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";

describe("cross-browser manifest", () => {
  it("declares a Manifest V3 module service worker", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.background.type).toBe("module");
    expect(manifest.background).not.toHaveProperty("scripts");
  });

  it("declares supported browser baselines", () => {
    expect(manifest.minimum_chrome_version).toBe("121");
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe("121.0");
  });
});
