import { describe, expect, it, vi } from "vitest";
import {
  applyDesktopUserDataDirOverride,
  DESKTOP_USER_DATA_DIR_ENV_VAR,
  resolveDesktopUserDataDirOverride,
} from "./user-data-env.js";

describe("user-data-env", () => {
  it("returns a trimmed override path when the env var is set", () => {
    expect(
      resolveDesktopUserDataDirOverride({
        [DESKTOP_USER_DATA_DIR_ENV_VAR]: "  /tmp/coder-studio-desktop-user-data  ",
      })
    ).toBe("/tmp/coder-studio-desktop-user-data");
  });

  it("returns null when the env var is missing or blank", () => {
    expect(resolveDesktopUserDataDirOverride({})).toBeNull();
    expect(
      resolveDesktopUserDataDirOverride({
        [DESKTOP_USER_DATA_DIR_ENV_VAR]: "   ",
      })
    ).toBeNull();
  });

  it("applies the override to Electron userData before startup", () => {
    const setPath = vi.fn();

    expect(
      applyDesktopUserDataDirOverride({
        app: {
          setPath,
        },
        env: {
          [DESKTOP_USER_DATA_DIR_ENV_VAR]: "/tmp/coder-studio-desktop-user-data",
        },
      })
    ).toBe("/tmp/coder-studio-desktop-user-data");
    expect(setPath).toHaveBeenCalledWith("userData", "/tmp/coder-studio-desktop-user-data");
  });
});
