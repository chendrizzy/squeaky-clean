# Real-Time Parallel Progress Tracking

## Overview

Squeaky Clean now features **real-time parallel progress tracking** for cache scanning operations. This provides immediate visual feedback as multiple cache scanners run simultaneously, showing the status of each tool being scanned in real-time.

## Features

### ✨ Key Capabilities

- **Simultaneous Status Updates**: Track 25+ cache scanners running in parallel
- **Real-Time Display**: Updates every 100ms for smooth, responsive feedback
- **Animated Indicators**: Spinner animations for active scans
- **Duration Tracking**: Shows elapsed time for each scanner
- **Size Reporting**: Displays cache sizes as they're discovered
- **Error Handling**: Gracefully shows errors without stopping other scanners
- **Lightweight Performance**: Minimal overhead, non-blocking design

### 🎯 Status Indicators

- **○** Pending (gray) - Scanner not yet started
- **⠋** Scanning (cyan, animated) - Actively scanning cache
- **✓** Complete (green) - Scan finished successfully
- **✗** Error (red) - Scanner encountered an error

## Usage

### Commands with Progress Tracking

The parallel progress tracker is automatically enabled for these commands:

```bash
# Size scanning with real-time progress
squeaky sizes

# Cache info with --sizes flag
squeaky clean --sizes --dry-run
```

### Example Output

```
Scanning 15 cache types (5 active, 8 complete, 0 errors) [2.3s]
  ✓ npm           complete - 234.5 MB [1.2s]
  ✓ yarn          complete - 156.8 MB [0.9s]
  ✓ pnpm          complete - 89.3 MB [0.7s]
  ⠋ docker        scanning (1.5s)
  ⠙ vscode        scanning (0.8s)
  ⠹ chrome        scanning (0.6s)
  ⠸ brew          scanning (1.1s)
  ⠼ cargo         scanning (0.9s)
  ✓ pip           complete - 45.2 MB [0.5s]
  ✓ gradle        complete - 512.7 MB [1.8s]
  ○ maven         pending
  ○ webpack       pending
  ○ vite          pending
  ○ nx            pending
  ○ turbo         pending

✓ Scan complete: 12/15 caches (1.2 GB) in 3.2s
```

## Architecture

### ParallelProgressTracker Class

Located in: `src/utils/parallelProgress.ts`

#### Key Methods

```typescript
// Create tracker
const tracker = createParallelTracker(['npm', 'yarn', 'docker']);

// Start tracking
tracker.start();

// Update scanner status
tracker.update('npm', 'scanning');
tracker.update('npm', 'complete', { size: 1024 * 1024 * 100 });

// Stop tracking
tracker.stop();

// Get summary
const summary = tracker.getSummary();
```

#### Helper Methods

```typescript
// Mark scanner as started
tracker.startScanner('npm');

// Mark as complete with size
tracker.complete('npm', 1024 * 1024 * 100);

// Mark as failed with error
tracker.fail('npm', 'Cache not accessible');
```

### Integration Points

The progress tracker integrates seamlessly with the existing `CacheManager`:

```typescript
// In CacheManager.getAllCacheInfo()
const cacheInfos = await cacheManager.getAllCacheInfo({
  showProgress: true  // Enable real-time progress tracking
});
```

## Performance Characteristics

### Overhead Metrics

- **Memory**: ~1-2 KB per scanner
- **CPU**: Minimal (~0.1% for 100ms refresh rate)
- **Display Update**: 100ms interval (10 FPS)
- **Non-Blocking**: Uses async intervals, doesn't block scanning

### Scalability

- Tested with 30+ simultaneous scanners
- Handles long-running scans (minutes) without performance degradation
- Terminal output optimized with ANSI escape codes for efficient rendering

## Implementation Details

### Display Rendering

The tracker uses ANSI escape codes for efficient terminal updates:

```typescript
// Move cursor up N lines and clear
process.stdout.write(`\x1b[${lines}A`);
process.stdout.write('\x1b[0J');
```

### Status Transitions

Valid status transitions:
- `pending` → `scanning`
- `scanning` → `complete`
- `scanning` → `error`

### Time Tracking

- **Start time**: Recorded when tracker.start() is called
- **Scanner start**: Recorded when status changes to "scanning"
- **Scanner end**: Recorded when status changes to "complete" or "error"
- **Duration calculation**: Automatic based on timestamps

## Configuration

### Enable/Disable Progress

Progress tracking is controlled via the `showProgress` option:

```typescript
// Enable progress tracking
await cacheManager.getAllCacheInfo({ showProgress: true });

// Disable (default)
await cacheManager.getAllCacheInfo({ showProgress: false });
```

### Color Support

Progress display respects the global color configuration:

```typescript
// In ~/.config/squeaky-clean/config.json
{
  "output": {
    "useColors": true  // Enable colored output
  }
}
```

## Testing

### Unit Tests

Run the comprehensive test suite:

```bash
npm test src/__tests__/utils/parallelProgress.test.ts
```

### Demo Script

See the progress tracker in action:

```bash
tsx examples/progress-demo.ts
```

This demonstrates:
- 15 simultaneous scanners
- Random scan durations (500ms - 3000ms)
- Simulated errors (15% failure rate)
- Real-time status updates
- Final summary statistics

## Future Enhancements

### Planned Features

- [ ] Configurable update interval (currently 100ms)
- [ ] Progress bars for individual scanners
- [ ] Estimated time remaining
- [ ] Bandwidth/throughput metrics
- [ ] Export progress data to JSON
- [ ] Terminal width auto-detection and responsive layout
- [ ] Grouping by cache type
- [ ] Sortable columns (name, size, duration)

## Troubleshooting

### Issue: Progress display is choppy or flickering

**Solution**: Ensure your terminal supports ANSI escape codes. Most modern terminals do, but some older or custom terminals may have issues.

### Issue: Progress doesn't show at all

**Solution**: Check that `showProgress: true` is set in the options. Also verify that stdout is a TTY (won't work in pipes or redirects).

### Issue: Colors don't appear

**Solution**: Check your config file's `output.useColors` setting. Also ensure your terminal supports colors.

## API Reference

### ParallelProgressTracker

```typescript
class ParallelProgressTracker {
  constructor(scannerNames: string[]);

  // Lifecycle
  start(): void;
  stop(): void;

  // Status updates
  update(name: string, status: ScanStatus, options?: {
    size?: number;
    error?: string;
  }): void;

  // Helper methods
  startScanner(name: string): void;
  complete(name: string, size?: number): void;
  fail(name: string, error: string): void;

  // Summary
  getSummary(): {
    total: number;
    complete: number;
    errors: number;
    totalSize: number;
    duration: number;
  };
}
```

### Factory Function

```typescript
function createParallelTracker(scannerNames: string[]): ParallelProgressTracker;
```

## Examples

### Basic Usage

```typescript
import { createParallelTracker } from './utils/parallelProgress';

const tracker = createParallelTracker(['npm', 'yarn', 'docker']);
tracker.start();

// Simulate parallel scanning
const scanners = ['npm', 'yarn', 'docker'];
await Promise.all(scanners.map(async (name) => {
  tracker.update(name, 'scanning');

  // Do actual scan work
  const result = await scanCache(name);

  tracker.complete(name, result.size);
}));

tracker.stop();
```

### With Error Handling

```typescript
const tracker = createParallelTracker(['npm', 'yarn', 'docker']);
tracker.start();

await Promise.all(scanners.map(async (name) => {
  try {
    tracker.update(name, 'scanning');
    const result = await scanCache(name);
    tracker.complete(name, result.size);
  } catch (error) {
    tracker.fail(name, error.message);
  }
}));

tracker.stop();

const summary = tracker.getSummary();
console.log(`Scanned ${summary.complete}/${summary.total} caches`);
```

## Contributing

When adding new cache cleaners, they automatically integrate with the progress tracker. No additional code is needed - just ensure your cleaner implements the `CleanerModule` interface.

## License

MIT License - see LICENSE file for details.
