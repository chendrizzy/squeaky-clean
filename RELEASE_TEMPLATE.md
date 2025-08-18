# 🎉 Squeaky Clean v1.0.0 - Initial Release

**Make your development environment squeaky clean!** ✨

We're excited to announce the first stable release of Squeaky Clean, a comprehensive developer cache cleaning tool that helps you reclaim disk space by intelligently clearing caches from your development environment.

## 🚀 What's New

### 18 Cache Cleaners Across 5 Categories

**📦 Package Managers (5)**
- npm, yarn, pnpm, bun, pip

**🔧 Build Tools (6)** 
- webpack, vite, nx, turbo, gradle, flutter

**💻 IDEs & Development (4)**
- vscode, xcode, androidstudio, jetbrains

**🌐 Browsers (2)**
- chrome, firefox

**⚙️ System Tools (1)**  
- docker

### ✨ Key Features

- **🎯 Smart Detection** - Automatically finds installed tools and available caches
- **🔍 Dry Run Mode** - Preview what will be cleaned before making changes
- **🎛️ Flexible Filtering** - Clean by type, include/exclude specific tools  
- **📊 Size Reporting** - Shows cache sizes and space that would be freed
- **🌍 Cross-Platform** - Works on macOS, Windows, and Linux
- **🛡️ Safe Operation** - Respects tool-specific cleaning mechanisms
- **🎨 Beautiful CLI** - Emoji-enhanced output with progress indicators
- **⚙️ Configuration** - Persistent settings for your preferences

## 📥 Installation

```bash
# Install globally via npm
npm install -g squeaky-clean

# Or use directly with npx (no installation required)
npx squeaky-clean clean --all
```

## 🎯 Quick Start

```bash
# List all available caches with sizes
squeaky list --sizes

# Preview what would be cleaned (safe!)
squeaky clean --dry-run  

# Clean all configured caches
squeaky clean --all

# Clean only package manager caches
squeaky clean --types package-manager

# Clean everything except Chrome cache
squeaky clean --exclude chrome
```

## 📊 Project Highlights

- **🧪 162 Tests** - Comprehensive test coverage (87.5% pass rate)
- **📦 70.1 kB** - Lightweight package size (484.3 kB unpacked)
- **🔐 Type-Safe** - Full TypeScript implementation  
- **🏗️ Modular** - Extensible architecture for adding new cleaners
- **📖 Well Documented** - Comprehensive guides and inline help

## 🛠️ What Can It Clean?

**Package Managers:** NPM cache, Yarn global cache, PNPM store, Bun cache, Python pip cache

**Build Tools:** Webpack build cache, Vite cache, NX cache, Turborepo cache, Gradle cache, Flutter cache

**IDEs:** VS Code extensions/logs, Xcode derived data, Android Studio cache, JetBrains caches

**Browsers:** Chrome DevTools cache, Firefox DevTools cache

**System:** Docker images/containers/volumes/build cache

## 🎬 Demo

![Squeaky Clean Demo](https://via.placeholder.com/800x400?text=Demo+GIF+Coming+Soon)

*Demo showing cache detection, size calculation, and cleaning in action*

## 📚 Documentation

- **[README](README.md)** - Complete usage guide and examples
- **[CHANGELOG](CHANGELOG.md)** - Detailed release notes
- **[TESTING](TESTING.md)** - Testing framework and coverage details
- **[PROJECT_STATUS](PROJECT_STATUS.md)** - Current project status and roadmap

## 🔮 Future Plans

- Additional cache cleaners (Redis, MongoDB, CI/CD caches)
- VS Code extension
- GitHub Action for CI cleanup  
- Scheduled cleaning with cron-like functionality
- Cache compression before clearing
- Backup/restore functionality

## 🤝 Contributing

We welcome contributions! Whether it's:
- 🐛 Bug reports
- 💡 Feature requests  
- 🔧 New cache cleaners
- 📖 Documentation improvements
- 🧪 Test coverage

See our [Contributing Guide](CONTRIBUTING.md) for details.

## 🙏 Acknowledgments

Built with ❤️ using:
- [Commander.js](https://github.com/tj/commander.js/) - CLI framework
- [Chalk](https://github.com/chalk/chalk) - Terminal styling  
- [Ora](https://github.com/sindresorhus/ora) - Progress spinners
- [Execa](https://github.com/sindresorhus/execa) - Process execution
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## 📊 Release Stats

- **🏷️ Version**: 1.0.0
- **📦 Package Size**: 70.1 kB compressed  
- **🗂️ Files**: 123 files included
- **⚡ Node.js**: Requires >=16.0.0
- **🧪 Tests**: 162 tests across 11 test suites
- **📈 Coverage**: 87.5% test pass rate

---

**Installation**: `npm install -g squeaky-clean`  
**Documentation**: [GitHub Repository](https://github.com/justinchen/squeaky-clean)  
**Support**: [Issues](https://github.com/justinchen/squeaky-clean/issues)

✨ **Happy Cleaning!** ✨
