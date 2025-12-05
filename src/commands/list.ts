import { cacheManager } from "../cleaners";
import { printHeader, printSuccess, printInfo, formatSize } from "../utils/cli";
import pc from "picocolors";

export async function listCommand(options?: any): Promise<void> {
  printHeader("Available Cache Cleaners");

  let allCleaners = cacheManager.getAllCleaners();

  // Filter by type if specified
  if (options?.type) {
    allCleaners = allCleaners.filter((c) => c.type === options.type);
  }

  // Group cleaners by type
  const cleanersByType = {
    "package-manager": allCleaners.filter((c) => c.type === "package-manager"),
    "build-tool": allCleaners.filter((c) => c.type === "build-tool"),
    ide: allCleaners.filter((c) => c.type === "ide"),
    system: allCleaners.filter((c) => c.type === "system"),
  };

  // Check availability for each cleaner
  console.log(pc.cyan("\nDetecting installed tools...\n"));

  let totalSize = 0;
  let availableCount = 0;

  for (const [type, cleaners] of Object.entries(cleanersByType)) {
    if (cleaners.length === 0) continue;

    const typeLabels = {
      "package-manager": "📦 Package Managers",
      "build-tool": "🔧 Build Tools",
      ide: "💻 Development Environments",
      system: "⚙️  System Tools",
    };

    console.log(pc.bold(typeLabels[type as keyof typeof typeLabels]));

    for (const cleaner of cleaners) {
      const isAvailable = await cleaner.isAvailable();
      const status = isAvailable
        ? pc.green("✅ Available")
        : pc.gray("⚪ Not detected");

      let sizeInfo = "";
      if (options?.sizes && isAvailable) {
        try {
          const result = await cleaner.getCacheInfo();
          if (result.size && result.size > 0) {
            sizeInfo = pc.yellow(` (${formatSize(result.size)})`);
            totalSize += result.size;
          }
        } catch (error) {
          // Silently ignore size check errors
        }
      }

      if (isAvailable) availableCount++;
      console.log(
        `  ${status} ${pc.bold(cleaner.name)}${sizeInfo} - ${cleaner.description}`,
      );
    }

    console.log(); // Add spacing between sections
  }

  printInfo(
    `Total cleaners: ${allCleaners.length} (${availableCount} available)`,
  );
  if (options?.sizes && totalSize > 0) {
    printInfo(`Total cache size: ${formatSize(totalSize)}`);
  }
  printSuccess(
    "Use \`squeaky-clean clean --dry-run\` to see what would be cleaned",
  );
}
