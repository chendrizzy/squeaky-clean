import { printSuccess, symbols } from "../utils/cli";
import { cacheManager } from "../cleaners";
import { config } from "../config";
import * as os from "os";

export async function doctorCommand(): Promise<void> {
  console.log("\n🩺 System Health Check");
  console.log("─".repeat(50));

  // System Information
  console.log("\n📋 System Information:");
  console.log(`${symbols.folder} Platform: ${os.platform()}`);
  console.log(`${symbols.folder} Architecture: ${os.arch()}`);
  console.log(`${symbols.folder} Node.js: ${process.version}`);
  console.log(`${symbols.folder} Home Directory: ${os.homedir()}`);
  console.log(`${symbols.folder} Current Directory: ${process.cwd()}`);

  // Configuration Status
  console.log("\n⚙️ Configuration:");
  const allCleaners = cacheManager.getAllCleaners();
  const enabledCleaners = cacheManager.getEnabledCleaners();
  console.log(`${symbols.folder} Total Cleaners: ${allCleaners.length}`);
  console.log(`${symbols.folder} Enabled Cleaners: ${enabledCleaners.length}`);

  if (enabledCleaners.length !== allCleaners.length) {
    const disabledCount = allCleaners.length - enabledCleaners.length;
    console.log(`${symbols.folder} Disabled Cleaners: ${disabledCount}`);
  }

  // Tool Detection
  console.log("\n🔍 Tool Detection:");
  let detectionIssues = 0;

  for (const cleaner of allCleaners) {
    try {
      const isAvailable = await cleaner.isAvailable();
      const status = isAvailable ? "✅" : "⚠️";
      const statusText = isAvailable ? "Available" : "Not Found";
      console.log(`${status} ${cleaner.name}: ${statusText}`);

      if (!isAvailable && config.isToolEnabled(cleaner.name as any)) {
        detectionIssues++;
      }
    } catch (error) {
      console.log(`❌ ${cleaner.name}: Detection Error - ${error}`);
      detectionIssues++;
    }
  }

  // Quick Cache Scan
  console.log("\n📊 Quick Cache Scan:");
  let scanIssues = 0;

  try {
    // Get cache info for enabled cleaners only (faster)
    const enabledCacheInfo = [];

    for (const cleaner of enabledCleaners.slice(0, 5)) {
      // Only check first 5 for speed
      try {
        console.log(`Checking ${cleaner.name}...`);
        const info = await cleaner.getCacheInfo();
        enabledCacheInfo.push(info);

        const sizeInMB = ((info.size || 0) / (1024 * 1024)).toFixed(1);
        const pathCount = info.paths.length;
        const status = pathCount > 0 ? "📁" : "📭";

        console.log(
          `${status} ${cleaner.name}: ${pathCount} locations, ${sizeInMB} MB`,
        );
      } catch (error) {
        console.log(`❌ ${cleaner.name}: Scan Error - ${error}`);
        scanIssues++;
      }
    }

    if (enabledCleaners.length > 5) {
      console.log(`... and ${enabledCleaners.length - 5} more cleaners`);
    }
  } catch (error) {
    console.log(`❌ Cache scan failed: ${error}`);
    scanIssues++;
  }

  // Performance Check
  console.log("\n⚡ Performance Check:");
  const freeMemory = os.freemem();
  const totalMemory = os.totalmem();
  const memoryUsage = (
    ((totalMemory - freeMemory) / totalMemory) *
    100
  ).toFixed(1);

  console.log(`${symbols.folder} Memory Usage: ${memoryUsage}%`);
  console.log(
    `${symbols.folder} Free Memory: ${(freeMemory / (1024 * 1024 * 1024)).toFixed(1)} GB`,
  );

  if (parseFloat(memoryUsage) > 90) {
    console.log(
      `⚠️ High memory usage detected - this may slow cache operations`,
    );
  }

  // Summary
  console.log("\n📋 Health Summary:");
  const totalIssues = detectionIssues + scanIssues;

  if (totalIssues === 0) {
    printSuccess("✅ System is healthy! No issues detected.");
  } else {
    console.log(`⚠️ Found ${totalIssues} issue(s):`);
    if (detectionIssues > 0) {
      console.log(`   - ${detectionIssues} tool detection issue(s)`);
    }
    if (scanIssues > 0) {
      console.log(`   - ${scanIssues} cache scan issue(s)`);
    }
  }

  console.log("\n💡 Tips:");
  console.log("• Run `squeaky list` to see all available tools");
  console.log("• Run `squeaky sizes` to see detailed cache information");
  console.log("• Run `squeaky clean --dry-run` to preview cleaning");

  console.log("");
}
