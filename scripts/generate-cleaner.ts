#!/usr/bin/env node
/**
 * Generator script for creating new cleaner modules
 * Usage: npm run generate:cleaner <name> <type>
 * Example: npm run generate:cleaner rust-cargo package-manager
 *
 * Updated to use modern CleanerModule pattern (v0.3.x+)
 */

import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import pc from "picocolors";

const CLEANER_TEMPLATE = `import { promises as fs } from "fs";
import path from "path";
import * as os from "os";
import execa from "execa";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheCategory,
  CacheSelectionCriteria,
} from "../types";
import {
  getDirectorySize,
  getEstimatedDirectorySize,
  pathExists,
  safeRmrf,
} from "../utils/fs";
import { printVerbose } from "../utils/cli";

export class {{ClassName}}Cleaner implements CleanerModule {
  name = "{{name}}";
  type = "{{type}}" as const;
  description = "{{description}}";

  private getCachePaths(): Array<{
    path: string;
    description: string;
    category: string;
    priority: "critical" | "important" | "normal" | "low";
    safeToDelete: boolean;
  }> {
    const homeDir = os.homedir();
    const platform = process.platform;

    const paths: Array<{
      path: string;
      description: string;
      category: string;
      priority: "critical" | "important" | "normal" | "low";
      safeToDelete: boolean;
    }> = [];

    if (platform === "darwin") {
      // macOS {{ClassName}} paths
      paths.push(
        {{macOSPaths}}
      );
    } else if (platform === "win32") {
      // Windows {{ClassName}} paths
      const appData =
        process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      const localAppData =
        process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");

      paths.push(
        {{windowsPaths}}
      );
    } else {
      // Linux {{ClassName}} paths
      const configDir =
        process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
      const cacheDir =
        process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      const dataDir =
        process.env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");

      paths.push(
        {{linuxPaths}}
      );
    }

    return paths;
  }

  async isAvailable(): Promise<boolean> {
    // Check if cache directories exist
    const cachePaths = this.getCachePaths();
    for (const { path: cachePath } of cachePaths) {
      if (await pathExists(cachePath)) {
        return true;
      }
    }

    // Also check if {{name}} is installed via command
    try {
      await execa("{{command}}", ["{{commandArg}}"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;

    for (const { path: cachePath, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue;

      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);
        const size = await getEstimatedDirectorySize(cachePath);
        totalSize += size;
        printVerbose(
          \`📁 \${cachePath}: \${(size / (1024 * 1024)).toFixed(1)} MB\`,
        );
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const cachePaths = this.getCachePaths();
    const categoryMap = new Map<string, CacheCategory>();

    for (const {
      path: cachePath,
      description,
      category,
      priority,
      safeToDelete,
    } of cachePaths) {
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

      const size = await getDirectorySize(cachePath);
      let stats;
      try {
        stats = await fs.stat(cachePath);
      } catch {
        stats = null;
      }

      const categoryId = \`{{name}}-\${category}\`;
      const existing = categoryMap.get(categoryId);

      if (existing) {
        existing.paths.push(cachePath);
        existing.size = (existing.size || 0) + size;
      } else {
        categoryMap.set(categoryId, {
          id: categoryId,
          name: \`{{ClassName}} \${category}\`,
          description,
          paths: [cachePath],
          size,
          lastModified: stats?.mtime,
          priority,
          useCase: "development",
        });
      }
    }

    return Array.from(categoryMap.values());
  }

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    _cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<ClearResult> {
    const cachePaths = this.getCachePaths();
    const clearedPaths: string[] = [];
    let sizeBefore = 0;
    let sizeAfter = 0;

    for (const { path: cachePath, description, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

      if (protectedPaths?.some((p) => cachePath.startsWith(p))) {
        printVerbose(\`  Skipping protected path: \${cachePath}\`);
        continue;
      }

      const pathSize = await getDirectorySize(cachePath);
      sizeBefore += pathSize;

      if (dryRun) {
        printVerbose(
          \`[DRY RUN] Would clear: \${description} (\${(pathSize / (1024 * 1024)).toFixed(1)} MB)\`,
        );
        clearedPaths.push(cachePath);
      } else {
        try {
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
          printVerbose(\`✓ Cleared: \${description}\`);
        } catch (error) {
          printVerbose(\`✗ Failed to clear \${description}: \${error}\`);
        }
      }
    }

    if (!dryRun) {
      for (const { path: cachePath, safeToDelete } of cachePaths) {
        if (!safeToDelete) continue;
        if (await pathExists(cachePath)) {
          sizeAfter += await getDirectorySize(cachePath);
        }
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore,
      sizeAfter: dryRun ? sizeBefore : sizeAfter,
      clearedPaths,
    };
  }

  async clearByCategory(
    categoryIds: string[],
    dryRun = false,
    _cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<ClearResult> {
    const categories = await this.getCacheCategories();
    const targetCategories = categories.filter((c) =>
      categoryIds.includes(c.id),
    );
    const clearedPaths: string[] = [];
    let sizeBefore = 0;
    let sizeAfter = 0;

    for (const category of targetCategories) {
      for (const cachePath of category.paths) {
        if (!(await pathExists(cachePath))) continue;

        if (protectedPaths?.some((p) => cachePath.startsWith(p))) {
          printVerbose(\`  Skipping protected path: \${cachePath}\`);
          continue;
        }

        const pathSize = await getDirectorySize(cachePath);
        sizeBefore += pathSize;

        if (dryRun) {
          printVerbose(
            \`[DRY RUN] Would clear: \${category.name} (\${(pathSize / (1024 * 1024)).toFixed(1)} MB)\`,
          );
          clearedPaths.push(cachePath);
        } else {
          try {
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
            printVerbose(\`✓ Cleared: \${category.name}\`);
          } catch (error) {
            printVerbose(\`✗ Failed to clear \${category.name}: \${error}\`);
          }
        }
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore,
      sizeAfter: dryRun ? sizeBefore : sizeAfter,
      clearedPaths,
      clearedCategories: categoryIds,
    };
  }
}

export default new {{ClassName}}Cleaner();
`;

const TEST_TEMPLATE = `import { describe, it, expect, beforeEach, vi } from "vitest";
import {{name}}Cleaner from "../../cleaners/{{fileName}}";

// Mock external dependencies
vi.mock("execa", () => ({
  default: vi.fn(),
}));

vi.mock("../../utils/fs", () => ({
  pathExists: vi.fn(),
  getDirectorySize: vi.fn(),
  getEstimatedDirectorySize: vi.fn(),
  safeRmrf: vi.fn(),
}));

vi.mock("../../utils/cli", () => ({
  printVerbose: vi.fn(),
}));

describe("{{ClassName}}Cleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic properties", () => {
    it("should have correct name", () => {
      expect({{name}}Cleaner.name).toBe("{{name}}");
    });

    it("should have correct type", () => {
      expect({{name}}Cleaner.type).toBe("{{type}}");
    });

    it("should have a description", () => {
      expect({{name}}Cleaner.description).toBeTruthy();
    });
  });

  describe("isAvailable", () => {
    it("should return true when cache directories exist", async () => {
      const { pathExists } = await import("../../utils/fs");
      vi.mocked(pathExists).mockResolvedValue(true);

      const result = await {{name}}Cleaner.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when no caches exist and command fails", async () => {
      const { pathExists } = await import("../../utils/fs");
      const execa = await import("execa");

      vi.mocked(pathExists).mockResolvedValue(false);
      vi.mocked(execa.default).mockRejectedValue(new Error("Command not found"));

      const result = await {{name}}Cleaner.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("getCacheInfo", () => {
    it("should return cache information with existing paths", async () => {
      const { pathExists, getEstimatedDirectorySize } = await import("../../utils/fs");

      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getEstimatedDirectorySize).mockResolvedValue(1024 * 1024 * 10); // 10 MB

      const info = await {{name}}Cleaner.getCacheInfo();

      expect(info.name).toBe("{{name}}");
      expect(info.type).toBe("{{type}}");
      expect(info.size).toBeGreaterThan(0);
    });

    it("should return zero size when no caches exist", async () => {
      const { pathExists } = await import("../../utils/fs");
      vi.mocked(pathExists).mockResolvedValue(false);

      const info = await {{name}}Cleaner.getCacheInfo();

      expect(info.size).toBe(0);
      expect(info.paths).toHaveLength(0);
    });
  });

  describe("getCacheCategories", () => {
    it("should return cache categories", async () => {
      const { pathExists, getDirectorySize } = await import("../../utils/fs");
      const fs = await import("fs");

      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(1024 * 1024 * 5); // 5 MB
      vi.spyOn(fs.promises, "stat").mockResolvedValue({
        mtime: new Date(),
      } as any);

      const categories = await {{name}}Cleaner.getCacheCategories();

      expect(Array.isArray(categories)).toBe(true);
    });
  });

  describe("clear", () => {
    it("should perform dry run without deleting", async () => {
      const { pathExists, getDirectorySize, safeRmrf } = await import("../../utils/fs");

      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(1024 * 1024 * 10);

      const result = await {{name}}Cleaner.clear(true);

      expect(result.success).toBe(true);
      expect(safeRmrf).not.toHaveBeenCalled();
    });

    it("should skip protected paths", async () => {
      const { pathExists, getDirectorySize, safeRmrf } = await import("../../utils/fs");

      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(1024 * 1024);

      const result = await {{name}}Cleaner.clear(false, undefined, undefined, [
        "/protected/path",
      ]);

      expect(result.success).toBe(true);
    });
  });
});
`;

// Helper to format path entries for template
function formatPathEntry(
  pathExpr: string,
  description: string,
  category: string,
  priority: "critical" | "important" | "normal" | "low" = "normal",
  safeToDelete: boolean = true,
): string {
  return `{
          path: ${pathExpr},
          description: "${description}",
          category: "${category}",
          priority: "${priority}",
          safeToDelete: ${safeToDelete},
        }`;
}

async function main() {
  console.log(pc.bold(pc.cyan("🚀 Squeaky Clean - Cleaner Generator\n")));
  console.log(
    pc.dim("Using modern CleanerModule pattern (implements CleanerModule)\n"),
  );

  // Get input from user
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Cleaner name (e.g., rust-cargo):",
      validate: (input) => {
        if (!input) return "Name is required";
        if (!/^[a-z0-9-]+$/.test(input))
          return "Name must be lowercase with hyphens only";
        return true;
      },
    },
    {
      type: "list",
      name: "type",
      message: "Cache type:",
      choices: [
        "package-manager",
        "build-tool",
        "browser",
        "ide",
        "system",
        "other",
      ],
    },
    {
      type: "input",
      name: "description",
      message: "Description:",
      default: (answers: { name: string }) =>
        `${answers.name} cache and temporary files`,
    },
    {
      type: "input",
      name: "command",
      message: "Command to check if installed (e.g., cargo):",
      default: (answers: { name: string }) => answers.name.split("-")[0],
    },
    {
      type: "input",
      name: "commandArg",
      message: "Command argument (e.g., --version):",
      default: "--version",
    },
    {
      type: "input",
      name: "macOSCachePath",
      message: "macOS cache path (relative to home, e.g., Library/Caches/foo):",
      default: (answers: { name: string }) => {
        const base = answers.name.split("-")[0];
        return `Library/Caches/${base}`;
      },
    },
    {
      type: "input",
      name: "linuxCachePath",
      message: "Linux cache path (relative to home, e.g., .cache/foo):",
      default: (answers: { name: string }) => {
        const base = answers.name.split("-")[0];
        return `.cache/${base}`;
      },
    },
    {
      type: "input",
      name: "windowsCachePath",
      message: "Windows cache path (relative to LocalAppData, e.g., foo/cache):",
      default: (answers: { name: string }) => {
        const base = answers.name.split("-")[0];
        return `${base}/Cache`;
      },
    },
    {
      type: "input",
      name: "defaultCategory",
      message: "Default cache category name:",
      default: "cache",
    },
    {
      type: "confirm",
      name: "createTest",
      message: "Create test file?",
      default: true,
    },
  ]);

  // Generate file names
  const className = answers.name
    .split("-")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  const fileName =
    answers.name.replace(/-/g, "") + (answers.name.includes("-") ? "" : "");

  // Generate multi-OS path entries
  const macOSPaths = formatPathEntry(
    `path.join(homeDir, "${answers.macOSCachePath}")`,
    `${className} application cache`,
    answers.defaultCategory,
    "normal",
    true,
  );

  const windowsPaths = formatPathEntry(
    `path.join(localAppData, "${answers.windowsCachePath}")`,
    `${className} application cache`,
    answers.defaultCategory,
    "normal",
    true,
  );

  const linuxPaths = formatPathEntry(
    `path.join(cacheDir, "${answers.linuxCachePath.replace(".cache/", "")}")`,
    `${className} application cache`,
    answers.defaultCategory,
    "normal",
    true,
  );

  // Replace template variables
  const cleanerContent = CLEANER_TEMPLATE.replace(/{{ClassName}}/g, className)
    .replace(/{{name}}/g, answers.name)
    .replace(/{{type}}/g, answers.type)
    .replace(/{{description}}/g, answers.description)
    .replace(/{{command}}/g, answers.command)
    .replace(/{{commandArg}}/g, answers.commandArg)
    .replace(/{{macOSPaths}}/g, macOSPaths)
    .replace(/{{windowsPaths}}/g, windowsPaths)
    .replace(/{{linuxPaths}}/g, linuxPaths)
    .replace(/{{fileName}}/g, fileName);

  const testContent = TEST_TEMPLATE.replace(/{{ClassName}}/g, className)
    .replace(/{{name}}/g, answers.name)
    .replace(/{{type}}/g, answers.type)
    .replace(/{{fileName}}/g, fileName);

  // Write files
  const cleanerPath = path.join(
    process.cwd(),
    "src",
    "cleaners",
    `${fileName}.ts`,
  );
  const testPath = path.join(
    process.cwd(),
    "src",
    "__tests__",
    "cleaners",
    `${fileName}.test.ts`,
  );

  // Check if files already exist
  if (fs.existsSync(cleanerPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `${cleanerPath} already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(pc.yellow("Aborted"));
      return;
    }
  }

  // Write cleaner file
  fs.writeFileSync(cleanerPath, cleanerContent);
  console.log(pc.green(`✅ Created cleaner: ${cleanerPath}`));

  // Write test file if requested
  if (answers.createTest) {
    const testDir = path.dirname(testPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testPath, testContent);
    console.log(pc.green(`✅ Created test: ${testPath}`));
  }

  // Instructions for next steps
  console.log(pc.bold(pc.yellow("\n📝 Next Steps:")));
  console.log(pc.gray("1. Review and customize the generated cleaner"));
  console.log(pc.gray("   - Add additional cache paths per platform"));
  console.log(pc.gray("   - Set appropriate priority and safeToDelete values"));
  console.log(pc.gray("   - Add more cache categories if needed"));
  console.log(pc.gray(`2. Add the cleaner to src/cleaners/index.ts:`));
  console.log(pc.cyan(`   import ${answers.name}Cleaner from "./${fileName}";`));
  console.log(
    pc.cyan(`   cleaners.set("${answers.name}", ${answers.name}Cleaner);`),
  );
  console.log(pc.gray("3. Run tests: npm test"));
  console.log(pc.gray("4. Test the cleaner: npm run dev -- clean --dry-run"));

  console.log(pc.bold(pc.green("\n✨ Done!")));
}

// Run the generator
main().catch((error) => {
  console.error(pc.red("Error:"), error);
  process.exit(1);
});
