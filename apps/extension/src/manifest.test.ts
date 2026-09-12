import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";

describe("cross-browser manifest", () => {
  it("declares both MV3 background environments", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.background.scripts).toEqual(["background.js"]);
  });

  it("declares supported browser baselines", () => {
    expect(manifest.minimum_chrome_version).toBe("121");
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe("121.0");
  });
});
