// Real-filesystem OS-behavior test for system-wide app-cache discovery. No
// mocks: it points os.homedir()/XDG/LOCALAPPDATA at a temp dir via env, lays
// down real cache fixtures, and runs the actual discovery + real du/walker
// sizing + classification for the current platform.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { AppCacheDiscoveryCleaner } from "../../cleaners/appCacheDiscovery";

const platform = os.platform();
let tmpHome: string;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

async function writeFixture(dir: string, bytes = 2048): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "blob.bin"), Buffer.alloc(bytes));
}

beforeAll(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "sq-os-home-"));

  // Redirect os.homedir(): POSIX reads $HOME, Windows reads %USERPROFILE%.
  if (platform === "win32") setEnv("USERPROFILE", tmpHome);
  else setEnv("HOME", tmpHome);

  if (platform === "darwin") {
    await writeFixture(path.join(tmpHome, "Library", "Caches", "com.example.coolapp"));
    // Sandboxed-app container cache (only the Caches subpath is a candidate).
    await writeFixture(
      path.join(tmpHome, "Library", "Containers", "com.example.Sandboxed", "Data", "Library", "Caches"),
      4096,
    );
  } else if (platform === "win32") {
    const local = path.join(tmpHome, "AppData", "Local");
    setEnv("LOCALAPPDATA", local);
    setEnv("APPDATA", path.join(tmpHome, "AppData", "Roaming"));
    await writeFixture(path.join(local, "CoolApp", "Cache"));
  } else {
    const xdgCache = path.join(tmpHome, ".cache");
    setEnv("XDG_CACHE_HOME", xdgCache);
    setEnv("XDG_CONFIG_HOME", path.join(tmpHome, ".config"));
    await writeFixture(path.join(xdgCache, "coolapp"));
    // Flatpak per-app cache.
    await writeFixture(path.join(tmpHome, ".var", "app", "com.example.App", "cache"), 4096);
  }
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe(`app-cache discovery (real filesystem, ${platform})`, () => {
  it("discovers cache dirs with real sizes and valid safety tiers", async () => {
    const cats = await new AppCacheDiscoveryCleaner().getCacheCategories();

    expect(cats.length).toBeGreaterThan(0);
    // At least one fixture was sized (real du/walker) to a non-zero value.
    expect(cats.some((c) => (c.size ?? 0) > 0)).toBe(true);
    for (const c of cats) {
      expect(["safe", "probably-safe", "caution", "manual"]).toContain(c.safety);
    }
  });

  it("discovers the platform-specific fixtures", async () => {
    const ids = (await new AppCacheDiscoveryCleaner().getCacheCategories()).map(
      (c) => c.id,
    );

    if (platform === "darwin") {
      expect(ids).toContain("app-caches:library-caches/com.example.coolapp");
      expect(ids).toContain("app-caches:containers/com.example.sandboxed");
    } else if (platform === "win32") {
      expect(ids.some((id) => id.includes("coolapp"))).toBe(true);
    } else {
      expect(ids).toContain("app-caches:xdg-cache/coolapp");
      expect(ids).toContain("app-caches:flatpak/com.example.app/cache");
    }
  });

  it("reports availability when a real discovery root exists", async () => {
    expect(await new AppCacheDiscoveryCleaner().isAvailable()).toBe(true);
  });
});
