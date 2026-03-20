import { describe, expect, test } from "vitest";
import { selectLatestStableRelease } from "../src/bootstrap/github-releases-client";

describe("github release selection", () => {
  test("selects the highest stable semver tag", () => {
    const result = selectLatestStableRelease([
      { tag_name: "v1.0.1", draft: false, prerelease: false, assets: [] },
      { tag_name: "v1.1.0", draft: false, prerelease: false, assets: [] },
      { tag_name: "v1.0.9", draft: false, prerelease: false, assets: [] },
    ]);

    expect(result?.tag_name).toBe("v1.1.0");
  });
});
