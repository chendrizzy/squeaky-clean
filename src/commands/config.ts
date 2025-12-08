import {
  printSuccess,
  printInfo,
  printError,
  printWarning,
  symbols,
} from "../utils/cli";
import { config } from "../config";
import { cacheManager } from "../cleaners";
import pc from "picocolors";
import inquirer from "inquirer";

interface ConfigOptions {
  list?: boolean;
  get?: string;
  set?: string;
  enable?: string | string[];
  disable?: string | string[];
  reset?: boolean;
  interactive?: boolean;
  path?: boolean;
  verbose?: boolean;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    console.log("\n⚙️ Configuration Management");
    console.log("─".repeat(35));

    // Show config path if requested
    if (options.path) {
      await showConfigPath();
      return;
    }

    // Interactive configuration wizard
    if (options.interactive) {
      await interactiveConfigWizard();
      return;
    }

    // If no options provided, show current config
    if (
      !options.list &&
      !options.get &&
      !options.set &&
      !options.enable &&
      !options.disable &&
      !options.reset
    ) {
      await showCurrentConfig();
      return;
    }

    // List all configuration options
    if (options.list) {
      await showCurrentConfig();
      return;
    }

    // Get specific configuration value
    if (options.get) {
      await getConfigValue(options.get);
      return;
    }

    // Set configuration value
    if (options.set) {
      await setConfigValue(options.set);
      return;
    }

    // Enable specific tool(s)
    const toolsToEnable = normalizeToolList(options.enable);
    if (toolsToEnable) {
      await updateToolStatus(toolsToEnable, true);
      return;
    }

    // Disable specific tool(s)
    const toolsToDisable = normalizeToolList(options.disable);
    if (toolsToDisable) {
      await updateToolStatus(toolsToDisable, false);
      return;
    }

    // Reset configuration
    if (options.reset) {
      await resetConfiguration();
      return;
    }
  } catch (error) {
    printError(`Config command error: ${error}`);
    throw error;
  }
}

async function showCurrentConfig(): Promise<void> {
  const currentConfig = config.get();

  console.log("\n📋 Current Configuration:");
  console.log();

  // Output settings
  console.log(pc.bold("📝 Output Settings:"));
  console.log(
    `  ${symbols.folder} Verbose: ${currentConfig.output?.verbose ? pc.green("enabled") : pc.gray("disabled")}`,
  );
  console.log(
    `  ${symbols.folder} Colors: ${currentConfig.output?.useColors !== false ? pc.green("enabled") : pc.gray("disabled")}`,
  );
  console.log();

  // Safety settings
  console.log(pc.bold("🔒 Safety Settings:"));
  console.log(
    `  ${symbols.folder} Require Confirmation: ${config.shouldRequireConfirmation() ? pc.yellow("yes") : pc.green("no")}`,
  );
  console.log();

  // Update settings
  const lastUpdateCheck = config.getLastUpdateCheck();
  console.log(pc.bold("🔄 Update Settings:"));
  console.log(
    `  ${symbols.folder} Auto-checks: ${config.isAutoUpdateEnabled() ? pc.green("enabled") : pc.gray("disabled")}`,
  );
  console.log(
    `  ${symbols.folder} Check interval: every ${config.getAutoUpdateCheckInterval()}h`,
  );
  console.log(
    `  ${symbols.folder} Last check: ${lastUpdateCheck ? lastUpdateCheck.toLocaleString() : "never"}`,
  );
  console.log();

  // Tool enablement
  console.log(pc.bold("🔧 Tool Enablement:"));
  const allCleaners = cacheManager.getAllCleaners();

  const groupedCleaners = {
    "package-manager": allCleaners.filter((c) => c.type === "package-manager"),
    "build-tool": allCleaners.filter((c) => c.type === "build-tool"),
    ide: allCleaners.filter((c) => c.type === "ide"),
    browser: allCleaners.filter((c) => c.type === "browser"),
    system: allCleaners.filter((c) => c.type === "system"),
  };

  const typeEmojis: Record<string, string> = {
    "package-manager": "📦",
    "build-tool": "🔨",
    ide: "💻",
    browser: "🌐",
    system: "⚙️",
  };

  for (const [type, cleaners] of Object.entries(groupedCleaners)) {
    if (cleaners.length === 0) continue;

    console.log(`  ${typeEmojis[type]} ${type}:`);
    for (const cleaner of cleaners) {
      const enabled = config.isToolEnabled(cleaner.name as any);
      const status = enabled ? pc.green("✓ enabled") : pc.red("✗ disabled");
      console.log(`     ${status} ${cleaner.name}`);
    }
  }

  console.log();
  printInfo(
    "💡 Use `squeaky config --help` to see available configuration options",
  );
}

async function getConfigValue(key: string): Promise<void> {
  const currentConfig = config.get();

  let value: any;
  switch (key.toLowerCase()) {
    case "verbose":
      value = currentConfig.output?.verbose;
      break;
    case "colors":
    case "usecolors":
      value = currentConfig.output?.useColors;
      break;
    default:
      // Try to get nested value
      const keys = key.split(".");
      value = keys.reduce((obj: any, k) => obj?.[k], currentConfig);
  }

  if (value !== undefined) {
    console.log(`\n${symbols.folder} ${key}: ${pc.bold(String(value))}`);
  } else {
    printWarning(`Configuration key '${key}' not found`);
    printInfo("Use `squeaky config --list` to see available options");
  }
}

async function setConfigValue(keyValue: string): Promise<void> {
  const [key, value] = keyValue.split("=", 2);

  if (!key || value === undefined) {
    printError("Invalid format. Use: --set key=value");
    printInfo("Example: --set verbose=true");
    return;
  }

  const currentConfig = config.get();
  let parsedValue: any = value;

  // Parse boolean values
  if (value.toLowerCase() === "true") parsedValue = true;
  else if (value.toLowerCase() === "false") parsedValue = false;

  // Update configuration
  switch (key.toLowerCase()) {
    case "verbose":
      config.set({
        ...currentConfig,
        output: { ...currentConfig.output, verbose: parsedValue },
      });
      printSuccess(`Set verbose output to ${parsedValue}`);
      break;

    case "colors":
    case "usecolors":
      config.set({
        ...currentConfig,
        output: { ...currentConfig.output, useColors: parsedValue },
      });
      printSuccess(`Set colored output to ${parsedValue}`);
      break;

    default:
      printError(`Unknown configuration key: ${key}`);
      printInfo("Use `squeaky config --list` to see available options");
      return;
  }
}

function normalizeToolList(
  input?: string | string[],
): string[] | null {
  if (!input) return null;

  const tools = (Array.isArray(input) ? input : [input])
    .flatMap((name) => name.split(","))
    .map((name) => name.trim())
    .filter(Boolean);

  if (tools.length === 0) return null;

  return Array.from(new Set(tools));
}

async function updateToolStatus(
  toolNames: string[],
  enabled: boolean,
): Promise<void> {
  const allCleaners = cacheManager.getAllCleaners();
  const availableTools = new Set(allCleaners.map((c) => c.name));
  const missingTools = toolNames.filter((name) => !availableTools.has(name));

  if (missingTools.length > 0) {
    const label = missingTools.length === 1 ? "Tool" : "Tools";
    printError(`${label} not found: ${missingTools.join(", ")}`);
    printInfo(`Available tools: ${allCleaners.map((c) => c.name).join(", ")}`);
    return;
  }

  const currentConfig = config.get();
  const tools = { ...currentConfig.tools } as Record<string, boolean>;

  toolNames.forEach((name) => {
    tools[name] = enabled;
  });

  config.set({ ...currentConfig, tools });

  const formattedList = toolNames.join(", ");
  const suffix = toolNames.length > 1 ? "cache cleaners" : "cache cleaner";

  if (enabled) {
    printSuccess(`✓ Enabled ${formattedList} ${suffix}`);
  } else {
    printWarning(`✗ Disabled ${formattedList} ${suffix}`);
  }
}

async function resetConfiguration(): Promise<void> {
  printWarning("This will reset all configuration to defaults.");
  printInfo(
    "All tools will be enabled and settings will be restored to defaults.",
  );

  // In a real implementation, you might want to ask for confirmation
  // Reset to defaults by creating a new default config
  const defaultConfig = {
    enabledCaches: {
      packageManagers: true,
      buildTools: true,
      browsers: true,
      ides: true,
      system: true,
    },
    tools: {
      // Package managers
      npm: true,
      yarn: true,
      pnpm: true,
      bun: true,
      pip: true,
      cargo: true,
      poetry: true,
      pipenv: true,
      cocoapods: true,
      swiftpm: true,
      nuget: true,
      brew: true,
      nix: true,
      // Build tools
      webpack: true,
      vite: true,
      nx: true,
      turbo: true,
      flutter: true,
      "node-gyp": true,
      "go-build": true,
      maven: true,
      playwright: true,
      // Browsers
      chrome: true,
      firefox: true,
      // IDEs
      vscode: true,
      xcode: true,
      androidstudio: true,
      jetbrains: true,
      windsurf: true,
      cursor: true,
      zed: true,
      // System tools
      docker: true,
      gradle: true,
      "universal-binary": false,
    },
    safety: {
      requireConfirmation: false,
      dryRunDefault: false,
      backupBeforeClearing: false,
      excludeSystemCritical: true,
    },
    customPaths: [],
    output: {
      verbose: false,
      showSizes: true,
      useColors: true,
    },
  };
  config.set(defaultConfig);
  printSuccess("✓ Configuration reset to defaults");

  // Show new configuration
  console.log();
  await showCurrentConfig();
}

async function showConfigPath(): Promise<void> {
  const configPath = config.getConfigPath();
  console.log(`\n📂 Configuration file location:`);
  console.log(`   ${pc.bold(configPath)}`);

  // Check if config file exists
  try {
    const fs = await import("fs");
    const exists = fs.existsSync(configPath);
    if (exists) {
      console.log(pc.green("   ✓ Config file exists"));
    } else {
      console.log(
        pc.yellow("   ⚠ Config file will be created when first used"),
      );
    }
  } catch (error) {
    console.log(pc.gray("   (Unable to check file existence)"));
  }
}

async function interactiveConfigWizard(): Promise<void> {
  console.log("\n🧙‍♂️ Interactive Configuration Wizard");
  console.log(
    pc.gray("This wizard will help you configure squeaky-clean settings.\n"),
  );

  const currentConfig = config.get();
  const allCleaners = cacheManager.getAllCleaners();

  // Group cleaners by type
  const groupedCleaners = {
    "package-manager": allCleaners.filter((c) => c.type === "package-manager"),
    "build-tool": allCleaners.filter((c) => c.type === "build-tool"),
    ide: allCleaners.filter((c) => c.type === "ide"),
    browser: allCleaners.filter((c) => c.type === "browser"),
    system: allCleaners.filter((c) => c.type === "system"),
  };

  // Step 1: Output preferences
  console.log(pc.bold("📝 Step 1: Output Preferences"));
  const outputAnswers = await inquirer.prompt([
    {
      type: "confirm",
      name: "verbose",
      message: "Enable verbose output (shows detailed information)?",
      default: currentConfig.output?.verbose || false,
    },
    {
      type: "confirm",
      name: "useColors",
      message:
        "Enable colored output (recommended for terminals that support colors)?",
      default: currentConfig.output?.useColors !== false,
    },
  ]);

  // Step 2: Safety preferences
  console.log(pc.bold("\n🔒 Step 2: Safety Preferences"));
  const safetyAnswers = await inquirer.prompt([
    {
      type: "confirm",
      name: "requireConfirmation",
      message:
        "Require confirmation before cleaning caches (recommended for safety)?",
      default: config.shouldRequireConfirmation(),
    },
  ]);

  // Step 3: Tool enablement by category
  console.log(pc.bold("\n🔧 Step 3: Tool Configuration"));
  console.log(
    pc.gray("Configure which cache cleaners should be enabled by category.\n"),
  );

  const toolAnswers: Record<string, boolean> = {};

  for (const [type, cleaners] of Object.entries(groupedCleaners)) {
    if (cleaners.length === 0) continue;

    const typeEmojis: Record<string, string> = {
      "package-manager": "📦",
      "build-tool": "🔨",
      ide: "💻",
      browser: "🌐",
      system: "⚙️",
    };

    console.log(
      pc.bold(
        `\n${typeEmojis[type]} ${type.charAt(0).toUpperCase() + type.slice(1).replace("-", " ")} Tools:`,
      ),
    );

    const categoryAnswers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "enabledTools",
        message: `Select which ${type.replace("-", " ")} tools to enable:`,
        choices: cleaners.map((cleaner) => ({
          name: `${cleaner.name} - ${cleaner.description}`,
          value: cleaner.name,
          checked: config.isToolEnabled(cleaner.name as any),
        })),
      },
    ]);

    // Mark selected tools as enabled, others as disabled for this category
    cleaners.forEach((cleaner) => {
      toolAnswers[cleaner.name] = categoryAnswers.enabledTools.includes(
        cleaner.name,
      );
    });
  }

  // Step 4: Review and apply
  console.log(pc.bold("\n📋 Step 4: Review Configuration"));
  console.log("\nYour new configuration will be:");
  console.log(
    `  ${symbols.folder} Verbose output: ${outputAnswers.verbose ? pc.green("enabled") : pc.gray("disabled")}`,
  );
  console.log(
    `  ${symbols.folder} Colored output: ${outputAnswers.useColors ? pc.green("enabled") : pc.gray("disabled")}`,
  );
  console.log(
    `  ${symbols.folder} Require confirmation: ${safetyAnswers.requireConfirmation ? pc.yellow("yes") : pc.green("no")}`,
  );

  console.log("\n🔧 Enabled tools:");
  const enabledTools = Object.entries(toolAnswers)
    .filter(([_, enabled]) => enabled)
    .map(([name, _]) => name);
  const disabledTools = Object.entries(toolAnswers)
    .filter(([_, enabled]) => !enabled)
    .map(([name, _]) => name);

  if (enabledTools.length > 0) {
    enabledTools.forEach((tool) => {
      console.log(`     ${pc.green("✓")} ${tool}`);
    });
  }

  if (disabledTools.length > 0) {
    console.log("\n🔧 Disabled tools:");
    disabledTools.forEach((tool) => {
      console.log(`     ${pc.red("✗")} ${tool}`);
    });
  }

  const { confirmApply } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmApply",
      message: "\nApply this configuration?",
      default: true,
    },
  ]);

  if (confirmApply) {
    // Apply the configuration
    const newConfig = {
      ...currentConfig,
      output: {
        ...currentConfig.output,
        verbose: outputAnswers.verbose,
        useColors: outputAnswers.useColors,
      },
      safety: {
        ...currentConfig.safety,
        requireConfirmation: safetyAnswers.requireConfirmation,
      },
      tools: {
        ...currentConfig.tools,
        ...toolAnswers,
      },
    };

    config.set(newConfig);
    printSuccess("\n✓ Configuration applied successfully!");

    // Show final configuration
    console.log();
    await showCurrentConfig();
  } else {
    printWarning("\n⚠ Configuration changes cancelled.");
  }
}
