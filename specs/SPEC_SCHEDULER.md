# Scheduler Service Technical Specification

## Overview
Background scheduling service for automated cache cleaning with cron-like syntax support.

## Architecture

### Components
```typescript
// src/services/scheduler/types.ts
export interface Schedule {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  config: CleanConfig;
  lastRun?: Date;
  nextRun?: Date;
  stats: ScheduleStats;
}

export interface ScheduleStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  totalSpaceSaved: number;
  averageRunTime: number;
}

export interface SchedulerService {
  add(schedule: Schedule): Promise<void>;
  remove(id: string): Promise<void>;
  update(id: string, schedule: Partial<Schedule>): Promise<void>;
  list(): Promise<Schedule[]>;
  run(id: string): Promise<ClearResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### Implementation Details

#### Core Scheduler (src/services/scheduler/index.ts)
```typescript
import * as cron from 'node-cron';
import { EventEmitter } from 'events';

export class Scheduler extends EventEmitter implements SchedulerService {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private schedules: Map<string, Schedule> = new Map();

  async add(schedule: Schedule): Promise<void> {
    // Validate cron expression
    if (!cron.validate(schedule.cronExpression)) {
      throw new Error(`Invalid cron expression: ${schedule.cronExpression}`);
    }

    // Create scheduled task
    const task = cron.schedule(schedule.cronExpression, async () => {
      await this.executeSchedule(schedule);
    }, {
      scheduled: schedule.enabled,
      timezone: process.env.TZ || 'UTC'
    });

    this.tasks.set(schedule.id, task);
    this.schedules.set(schedule.id, schedule);

    // Persist to config
    await this.persistSchedules();

    this.emit('schedule:added', schedule);
  }

  private async executeSchedule(schedule: Schedule): Promise<void> {
    const startTime = Date.now();

    try {
      // Import cleaners dynamically to avoid circular deps
      const { getCleaner } = await import('../../cleaners');
      const result = await getCleaner(schedule.config);

      // Update stats
      schedule.stats.totalRuns++;
      schedule.stats.successfulRuns++;
      schedule.stats.totalSpaceSaved += result.spaceSaved;
      schedule.stats.averageRunTime =
        (schedule.stats.averageRunTime * (schedule.stats.totalRuns - 1) +
         (Date.now() - startTime)) / schedule.stats.totalRuns;

      schedule.lastRun = new Date();
      schedule.nextRun = this.getNextRun(schedule.cronExpression);

      await this.persistSchedules();
      this.emit('schedule:executed', { schedule, result });

    } catch (error) {
      schedule.stats.totalRuns++;
      schedule.stats.failedRuns++;

      this.emit('schedule:failed', { schedule, error });
      throw error;
    }
  }
}
```

#### Background Service Manager (src/services/scheduler/daemon.ts)
```typescript
import { fork, ChildProcess } from 'child_process';
import * as path from 'path';

export class DaemonManager {
  private process?: ChildProcess;
  private pidFile = path.join(os.homedir(), '.squeaky-clean', 'scheduler.pid');

  async start(): Promise<void> {
    // Check if already running
    if (await this.isRunning()) {
      throw new Error('Scheduler already running');
    }

    // Fork background process
    this.process = fork(
      path.join(__dirname, 'worker.js'),
      [],
      {
        detached: true,
        stdio: 'ignore'
      }
    );

    // Save PID
    await fs.writeFile(this.pidFile, this.process.pid.toString());

    // Detach from parent
    this.process.unref();
  }

  async stop(): Promise<void> {
    const pid = await this.getPid();
    if (pid) {
      process.kill(pid, 'SIGTERM');
      await fs.unlink(this.pidFile);
    }
  }

  async isRunning(): Promise<boolean> {
    const pid = await this.getPid();
    if (!pid) return false;

    try {
      process.kill(pid, 0); // Check if process exists
      return true;
    } catch {
      return false;
    }
  }
}
```

### CLI Commands

#### squeaky schedule add
```typescript
// src/commands/schedule.ts
export async function scheduleCommand(program: Command) {
  const schedule = program
    .command('schedule')
    .description('Manage cache cleaning schedules');

  schedule
    .command('add')
    .description('Add a new schedule')
    .option('--name <name>', 'Schedule name')
    .option('--cron <expression>', 'Cron expression (e.g., "0 2 * * *")')
    .option('--tools <tools...>', 'Tools to clean')
    .option('--dry-run', 'Preview without cleaning')
    .action(async (options) => {
      const scheduler = new Scheduler();

      // Interactive mode if no options
      if (!options.cron) {
        options = await promptScheduleDetails();
      }

      const schedule: Schedule = {
        id: crypto.randomUUID(),
        name: options.name || `Schedule ${Date.now()}`,
        cronExpression: options.cron,
        enabled: true,
        config: {
          tools: options.tools,
          dryRun: options.dryRun
        },
        stats: {
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
          totalSpaceSaved: 0,
          averageRunTime: 0
        }
      };

      await scheduler.add(schedule);
      console.log(chalk.green(`✅ Schedule "${schedule.name}" added`));
      console.log(`   Next run: ${schedule.nextRun}`);
    });
}
```

#### squeaky schedule list
```bash
$ squeaky schedule list

📅 Active Schedules
─────────────────────

Name: Daily Cleanup
Cron: 0 2 * * * (Every day at 2:00 AM)
Tools: npm, yarn, docker
Status: ✅ Enabled
Last Run: 2024-11-17 02:00:00 (Saved 2.3 GB)
Next Run: 2024-11-18 02:00:00
Statistics:
  • Total Runs: 30
  • Success Rate: 96.7%
  • Total Saved: 68.4 GB
  • Avg Runtime: 45s

Name: Weekly Deep Clean
Cron: 0 3 * * 0 (Every Sunday at 3:00 AM)
Tools: all
Status: ✅ Enabled
Last Run: 2024-11-10 03:00:00 (Saved 8.7 GB)
Next Run: 2024-11-17 03:00:00
Statistics:
  • Total Runs: 4
  • Success Rate: 100%
  • Total Saved: 34.8 GB
  • Avg Runtime: 3m 20s
```

### Configuration

#### Config Schema Update
```typescript
// src/config/schema.ts
export interface Config {
  // ... existing fields ...

  schedules?: Schedule[];

  scheduler?: {
    enabled: boolean;
    logFile?: string;
    notifyOnError?: boolean;
    notifyOnSuccess?: boolean;
    maxConcurrent?: number;
  };
}
```

#### Example Configuration
```json
{
  "schedules": [
    {
      "id": "daily-clean",
      "name": "Daily Cleanup",
      "cronExpression": "0 2 * * *",
      "enabled": true,
      "config": {
        "tools": ["npm", "yarn", "pip"],
        "options": {
          "olderThan": "7d",
          "excludeActive": true
        }
      }
    }
  ],
  "scheduler": {
    "enabled": true,
    "logFile": "~/.squeaky-clean/scheduler.log",
    "notifyOnError": true,
    "notifyOnSuccess": false,
    "maxConcurrent": 1
  }
}
```

### Smart Detection

#### Disk Space Trigger
```typescript
export class DiskSpaceMonitor {
  private threshold: number = 90; // percentage

  async checkAndClean(): Promise<void> {
    const usage = await this.getDiskUsage();

    if (usage.percentage > this.threshold) {
      console.log(chalk.yellow(`⚠️ Disk usage at ${usage.percentage}%`));
      console.log('Starting automatic cleanup...');

      // Run progressive cleanup
      const cleaners = ['npm', 'docker', 'gradle', 'xcode'];

      for (const tool of cleaners) {
        await this.cleanTool(tool);

        const newUsage = await this.getDiskUsage();
        if (newUsage.percentage < this.threshold - 10) {
          break; // Enough space freed
        }
      }
    }
  }
}
```

### Testing

#### Unit Tests
```typescript
// src/__tests__/scheduler/scheduler.test.ts
describe('Scheduler Service', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
    vi.useFakeTimers();
  });

  it('should validate cron expressions', async () => {
    const invalidSchedule = {
      cronExpression: 'invalid'
    };

    await expect(scheduler.add(invalidSchedule))
      .rejects.toThrow('Invalid cron expression');
  });

  it('should execute schedule at specified time', async () => {
    const schedule = {
      cronExpression: '*/5 * * * * *', // Every 5 seconds
      // ... other fields
    };

    await scheduler.add(schedule);
    await scheduler.start();

    // Fast-forward 5 seconds
    vi.advanceTimersByTime(5000);

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});
```

### Error Handling

```typescript
class SchedulerError extends Error {
  constructor(
    message: string,
    public code: string,
    public schedule?: Schedule
  ) {
    super(message);
    this.name = 'SchedulerError';
  }
}

// Usage
if (!cron.validate(expression)) {
  throw new SchedulerError(
    'Invalid cron expression',
    'INVALID_CRON',
    schedule
  );
}
```

### Performance Considerations

1. **Resource Limits**: Max 1 cleanup running at a time
2. **Throttling**: Minimum 5 minutes between runs
3. **Memory**: Stream large file lists instead of loading
4. **CPU**: Nice process priority for background tasks

### Security

1. **No root/sudo**: All operations in user space
2. **Validation**: Strict cron expression validation
3. **Sandboxing**: Limited file system access
4. **Audit**: Log all scheduled operations

### Monitoring & Observability

```typescript
// Prometheus metrics
export const metrics = {
  schedulesTotal: new Counter({
    name: 'squeaky_schedules_total',
    help: 'Total number of schedules'
  }),

  schedulesExecuted: new Counter({
    name: 'squeaky_schedules_executed_total',
    help: 'Total number of executed schedules'
  }),

  spaceSaved: new Gauge({
    name: 'squeaky_space_saved_bytes',
    help: 'Total space saved in bytes'
  })
};
```

## Migration Path

### Phase 1: Core Implementation (Week 1-2)
- Basic scheduler with cron support
- CLI commands
- Config persistence

### Phase 2: Background Service (Week 3-4)
- Daemon process
- PID management
- Auto-start on boot

### Phase 3: Smart Features (Week 5-6)
- Disk space monitoring
- Build hooks
- Watch mode

### Phase 4: Polish (Week 7)
- Error handling
- Notifications
- Performance optimization