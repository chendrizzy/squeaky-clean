import {
  printInfo,
  printSuccess,
  printError,
  formatSizeWithColor,
  symbols,
} from "../utils/cli";
import { cacheManager } from "../cleaners";
import ora from "ora";

export async function sizesCommand(_options: any): Promise<void> {
  try {
    printInfo(`${symbols.soap} Cache Sizes`);
    printInfo("──────────────");

    const spinner = ora("Scanning cache directories...").start();

    try {
      const cacheInfos = await cacheManager.getAllCacheInfo();
      spinner.stop();

      console.log(); // Add some space

      let totalSize = 0;
      let foundCaches = 0;

      // Group by cache type
      const groupedCaches = new Map<string, typeof cacheInfos>();

      for (const info of cacheInfos) {
        const type = info.type || "other";
        if (!groupedCaches.has(type)) {
          groupedCaches.set(type, []);
        }
        groupedCaches.get(type)!.push(info);
      }

      // Display results grouped by type
      const typeEmojis: Record<string, string> = {
        "package-manager": "📦",
        "build-tool": "🔧",
        ide: "💻",
        browser: "🌐",
        system: "⚙️",
        other: "📁",
      };

      const typeNames: Record<string, string> = {
        "package-manager": "Package Managers",
        "build-tool": "Build Tools",
        ide: "Development Environments",
        browser: "Browsers",
        system: "System Tools",
        other: "Other",
      };

      for (const [type, infos] of groupedCaches) {
        const emoji = typeEmojis[type] || "📁";
        const typeName = typeNames[type] || type;

        console.log(`${emoji} ${typeName}`);

        for (const info of infos) {
          if (info.size && info.size > 0) {
            const sizeFormatted = formatSizeWithColor(info.size);
            printSuccess(`  ✅ ${info.name}: ${sizeFormatted}`);
            totalSize += info.size;
            foundCaches++;
          } else if (info.paths && info.paths.length > 0) {
            printInfo(`  ⚪ ${info.name}: No cache data found`);
          } else {
            printInfo(`  ❌ ${info.name}: Not available`);
          }
        }
        console.log(); // Space between groups
      }

      // Summary
      if (foundCaches > 0) {
        const totalFormatted = formatSizeWithColor(totalSize);
        printSuccess(
          `📊 Total cache size: ${totalFormatted} across ${foundCaches} cache${foundCaches > 1 ? "s" : ""}`,
        );
        printInfo(
          `💡 Use 'squeaky clean --dry-run' to see what can be cleaned`,
        );
      } else {
        printInfo(
          "No cache data found. This might mean caches are already clean or tools aren't installed.",
        );
      }
    } catch (error) {
      spinner.fail("Failed to scan cache directories");
      throw error;
    }
  } catch (error) {
    printError(`Sizes command error: ${error}`);
    throw error;
  }
}
