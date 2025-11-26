# Feature Specification: Automation & Scheduling

**Feature Branch**: `001-automation-scheduling`
**Created**: 2025-11-18
**Status**: Draft
**Input**: Professional tier feature enabling automated cache cleaning via cron-based scheduling, watch mode, and build hooks integration

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Daily Automated Cleanup (Priority: P1)

A freelance developer wants their development machine to automatically clean caches every night at 2 AM when they're not working, freeing up disk space without manual intervention.

**Why this priority**: Core value proposition of Professional tier - automated maintenance is the primary reason users would upgrade from free Community edition. Delivers immediate, recurring value.

**Independent Test**: Can be fully tested by creating a schedule, advancing system time to trigger execution, and verifying cache was cleaned and statistics were recorded. Delivers standalone value of "set and forget" automation.

**Acceptance Scenarios**:

1. **Given** user has installed squeaky-clean Professional, **When** they run `squeaky schedule add --name "Daily Cleanup" --cron "0 2 * * *" --tools npm,yarn,docker`, **Then** schedule is created and confirmed with next run time displayed
2. **Given** a schedule exists, **When** the scheduled time arrives, **Then** cache cleaning executes automatically, space is freed, and stats are updated
3. **Given** multiple schedules exist, **When** user runs `squeaky schedule list`, **Then** all schedules are displayed with status, last run time, space saved, and next run time
4. **Given** user wants to stop automation, **When** they run `squeaky schedule remove [schedule-id]`, **Then** schedule is deleted and no longer executes

---

### User Story 2 - Disk Space Threshold Trigger (Priority: P2)

A developer working on multiple large projects wants automatic cleanup when disk space drops below 10GB, preventing "disk full" errors during builds.

**Why this priority**: Proactive problem prevention - prevents workflow interruption. Builds on P1 by adding intelligence to scheduling. Essential for Professional tier value but requires P1 scheduler foundation.

**Independent Test**: Can be tested by configuring threshold, artificially filling disk to trigger level, and verifying automatic cleanup executes. Delivers value of "automatic emergency cleanup".

**Acceptance Scenarios**:

1. **Given** user configures disk threshold via `squeaky config set disk-threshold 10GB`, **When** available disk space drops below threshold, **Then** automatic cleanup executes targeting low-priority caches first
2. **Given** emergency cleanup is triggered, **When** space is freed to safe level (threshold + 5GB), **Then** cleanup stops and user is notified of action taken
3. **Given** disk usage is monitored, **When** user runs `squeaky status --disk`, **Then** current disk usage, threshold, and estimated cleanup potential are displayed

---

### User Story 3 - Build Hook Integration (Priority: P3)

A team wants cache cleaning integrated into their build pipeline, running automatically after successful builds to clean build artifacts and temporary caches.

**Why this priority**: Workflow integration - seamlessly fits into existing processes. Adds convenience but requires P1 scheduler and P2 triggers. Valuable for teams using squeaky-clean regularly.

**Independent Test**: Can be tested by configuring post-build hook, running a build, and verifying cleanup executes automatically after build completes. Delivers value of "zero-thought maintenance".

**Acceptance Scenarios**:

1. **Given** user has npm scripts in package.json, **When** they run `squeaky hooks add --event post-build --command "squeaky clean --tools webpack,vite"`, **Then** hook is registered and executes after npm builds
2. **Given** build hook is configured, **When** build completes successfully, **Then** specified caches are cleaned and results logged
3. **Given** build fails, **When** post-build hook would trigger, **Then** cleanup is skipped (preserves debug artifacts)

---

### User Story 4 - Watch Mode for Active Development (Priority: P4)

A developer working on a long-running project wants watch mode that detects inactive cache directories (not accessed in 7+ days) and cleans them automatically.

**Why this priority**: Advanced intelligence - optimizes storage without user thinking. Nice-to-have enhancement that builds on all previous priorities. Represents premium automation value.

**Independent Test**: Can be tested by enabling watch mode, creating test cache directories with old timestamps, waiting for detection interval, and verifying only old caches are cleaned. Delivers value of "smart, hands-off optimization".

**Acceptance Scenarios**:

1. **Given** user enables watch mode via `squeaky watch --enable --interval hourly --age-threshold 7d`, **When** watch daemon starts, **Then** it monitors cache directories and cleans those not accessed in 7+ days
2. **Given** watch mode is active, **When** user runs `squeaky watch status`, **Then** monitored directories, last scan time, and cleanup history are displayed
3. **Given** watch mode detects eligible caches, **When** cleanup would free <100MB, **Then** cleanup is deferred (avoids trivial operations)

---

### Edge Cases

- What happens when cron expression is invalid? → Validation error with helpful suggestion for correct syntax
- How does system handle schedule execution during system sleep/shutdown? → Missed schedules execute on next daemon start with notification
- What if multiple schedules target same cache simultaneously? → Mutex lock prevents concurrent cleaning, second schedule waits or skips
- How are errors during automated cleanup handled? → Logged to `~/.squeaky-clean/scheduler.log`, user notified on next CLI interaction, schedule remains active
- What happens if disk threshold check fails (permissions/unmounted volume)? → Graceful fallback to schedule-based cleaning, error logged
- How does daemon behave on low-memory systems? → Nice process priority, maximum 1 concurrent cleanup, memory-efficient streaming operations

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support cron expression syntax for schedule definition (standard 5-field format: minute hour day month weekday)
- **FR-002**: System MUST validate cron expressions before saving schedules and provide helpful error messages for invalid syntax
- **FR-003**: System MUST persist schedules to configuration file at `~/.squeaky-clean/config.json` under `schedules` array
- **FR-004**: System MUST run as background daemon process that survives terminal closure and respects system shutdown/reboot
- **FR-005**: System MUST record PID (process identifier) to `~/.squeaky-clean/scheduler.pid` for status checking and graceful shutdown
- **FR-006**: System MUST track schedule statistics including totalRuns, successfulRuns, failedRuns, totalSpaceSaved, and averageRunTime
- **FR-007**: System MUST update lastRun and nextRun timestamps after each execution
- **FR-008**: System MUST support enabling/disabling schedules without deletion via `enabled: boolean` flag
- **FR-009**: System MUST prevent concurrent cleanups by enforcing maximum 1 cleanup operation at a time
- **FR-010**: System MUST log all schedule executions to `~/.squeaky-clean/scheduler.log` with timestamp, schedule name, result, and errors
- **FR-011**: System MUST support disk space threshold monitoring with configurable threshold (e.g., 10GB, 5%, etc.)
- **FR-012**: System MUST execute progressive cleanup (low priority first, then normal, then important) when threshold triggered
- **FR-013**: System MUST stop cleanup when safe space level reached (threshold + buffer) to avoid over-cleaning
- **FR-014**: System MUST support build hook integration via `squeaky hooks add` command with events: pre-build, post-build, post-test
- **FR-015**: System MUST register hooks in npm scripts or as git hooks depending on project type
- **FR-016**: System MUST skip post-build cleanup if build fails (exit code ≠ 0)
- **FR-017**: System MUST support watch mode daemon that monitors cache directories at configurable intervals (hourly, daily)
- **FR-018**: System MUST check file access timestamps to determine cache staleness for watch mode cleanup
- **FR-019**: System MUST defer trivial cleanups (potential space saved < configurable minimum, default 100MB)
- **FR-020**: System MUST provide status commands showing daemon state, active schedules, and next execution times
- **FR-021**: System MUST handle timezone configuration via environment variable TZ or default to UTC
- **FR-022**: System MUST support graceful shutdown on SIGTERM signal, completing active cleanup before exit
- **FR-023**: System MUST restart daemon automatically on system reboot via launchd (macOS), systemd (Linux), or Task Scheduler (Windows)
- **FR-024**: System MUST enforce rate limiting with minimum 5 minutes between consecutive cleanup runs to prevent resource exhaustion
- **FR-025**: System MUST notify users of errors via CLI message on next interaction (non-intrusive, no email/push notifications in v1)

### Key Entities

- **Schedule**: Represents a configured automation rule with id (UUID), name (user-friendly label), cronExpression (5-field cron syntax), enabled (boolean flag), config (CleanConfig specifying tools and options), lastRun (Date of last execution), nextRun (Date of next scheduled execution), stats (ScheduleStats metrics object)

- **ScheduleStats**: Metrics tracking for schedule performance with totalRuns (count of all executions), successfulRuns (count of successful completions), failedRuns (count of failures), totalSpaceSaved (cumulative bytes freed), averageRunTime (mean execution duration in milliseconds)

- **CleanConfig**: Configuration for cleanup operation with tools (array of tool names like 'npm', 'docker'), options (CacheSelectionCriteria with olderThan, excludeActive flags), dryRun (boolean for preview mode)

- **DaemonProcess**: Background service instance with pid (process identifier), pidFile (path to .pid file), status (running/stopped), activeCleanup (current operation or null)

- **DiskThreshold**: Disk space monitoring configuration with threshold (minimum free space as bytes or percentage), enabled (boolean), lastCheck (timestamp), action (cleanup strategy: progressive/aggressive)

- **BuildHook**: Integration point for build tools with event (trigger: pre-build/post-build/post-test), command (squeaky CLI command to execute), projectType (npm/git/gradle), enabled (boolean)

- **WatchConfig**: Watch mode settings with enabled (boolean), interval (check frequency: hourly/daily), ageThreshold (minimum file age for cleanup eligibility), minimumCleanup (skip if potential space < this value), monitoredPaths (array of cache directories)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a functioning schedule in under 60 seconds using interactive mode `squeaky schedule add` or direct command with --cron flag
- **SC-002**: Scheduled cleanups execute within 60 seconds of scheduled time when daemon is running (excluding system sleep scenarios)
- **SC-003**: Daemon process consumes < 50MB RAM when idle and < 200MB during active cleanup operations
- **SC-004**: Schedule statistics accurately reflect execution history with < 1% error rate in space saved calculations
- **SC-005**: Disk threshold triggers emergency cleanup within 5 minutes of threshold breach detection
- **SC-006**: Build hooks integrate successfully with npm (package.json scripts), git (pre-commit/post-merge hooks), and Gradle without requiring manual configuration
- **SC-007**: Watch mode identifies stale caches with 100% accuracy based on file system timestamps (no false positives cleaning active caches)
- **SC-008**: CLI `squeaky schedule list` command displays all schedules with complete information (name, cron, status, next run, stats) in under 100ms
- **SC-009**: Daemon survives system reboot and resumes operation automatically within 60 seconds of system startup
- **SC-010**: Failed schedule executions are logged with actionable error messages and troubleshooting guidance, resolving 80% of issues without support tickets
- **SC-011**: Concurrent cleanup requests are handled gracefully with clear feedback ("Another cleanup in progress, queued/skipped")
- **SC-012**: Professional tier users report 90%+ satisfaction with automation features based on survey (target: 6 months post-launch)
- **SC-013**: Automation reduces manual `squeaky clean` commands by 80% for Professional tier users (measured via telemetry)
- **SC-014**: Zero data loss or corruption events attributed to automated cleanup operations (critical reliability metric)
- **SC-015**: Cross-platform functionality verified on macOS (launchd), Ubuntu/Fedora (systemd), and Windows (Task Scheduler) with 95%+ feature parity

### Technical Validation

- **TV-001**: Unit test coverage ≥ 85% for scheduler module (src/services/scheduler/)
- **TV-002**: Integration tests verify cron expression parsing, schedule execution, and statistic tracking
- **TV-003**: E2E tests validate daemon lifecycle (start/stop/restart) across supported platforms
- **TV-004**: Performance benchmarks confirm schedule execution overhead < 5% CPU for 10 concurrent schedules
- **TV-005**: Security audit confirms no privilege escalation, operates entirely in user space, no root/sudo requirements
- **TV-006**: Compatibility testing validates node-cron library behavior across Node.js 16.x, 18.x, 20.x

## Architecture & Implementation Notes

### Core Components

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

### CLI Commands

- `squeaky schedule add` → Interactive wizard or direct creation with flags
- `squeaky schedule list` → Display all schedules with status and stats
- `squeaky schedule remove <id>` → Delete specific schedule
- `squeaky schedule enable/disable <id>` → Toggle schedule without deletion
- `squeaky schedule run <id>` → Manual trigger for testing
- `squeaky daemon start/stop/restart` → Control background service
- `squeaky daemon status` → Show daemon PID, uptime, active schedules
- `squeaky hooks add --event <event> --command <cmd>` → Register build hook
- `squeaky hooks list` → Show configured hooks
- `squeaky watch enable/disable` → Toggle watch mode
- `squeaky watch status` → Show monitored paths and last scan

### Dependencies

- `node-cron` (^3.0.3) → Cron expression parsing and scheduling
- Platform-specific daemon managers:
  - macOS: launchd plist generation
  - Linux: systemd service unit generation
  - Windows: node-windows for Task Scheduler integration

### Migration Path

**Phase 1** (Weeks 1-2): Core scheduler with cron support, config persistence, basic CLI commands
**Phase 2** (Weeks 3-4): Background daemon process, PID management, cross-platform auto-start
**Phase 3** (Weeks 5-6): Disk space monitoring, build hooks, watch mode
**Phase 4** (Week 7): Error handling, notifications, performance optimization, documentation

### Professional Tier Gating

- Scheduler commands check license tier via config file `tier: 'professional' | 'team' | 'enterprise'`
- Free Community users see upgrade prompt: "Automation requires Professional tier ($15/mo). Try free for 14 days?"
- Trial activation via `squeaky upgrade --trial` enables all Professional features for 14 days
- License validation via local file (no phone-home in v1, honor system + periodic verification)

## Open Questions

1. **Notification Strategy**: Push notifications (Slack/email) for failed schedules or keep CLI-only in v1? → Recommend CLI-only to reduce complexity, add integrations in v1.1
2. **Cloud Sync**: Should schedules sync across machines for same Professional user? → Defer to v1.1, local-only sufficient for MVP
3. **Schedule Conflicts**: How to handle overlapping schedules targeting same cache? → Implement mutex lock with queue vs. skip behavior (configurable)
4. **Daemon Restart**: Auto-restart daemon on crash or require manual intervention? → Auto-restart via platform services (launchd/systemd) with crash reporting
5. **Windows Compatibility**: Full feature parity on Windows or gracefully degrade? → Target 95% parity, document known limitations (e.g., file locking differences)

## Risk Mitigation

- **Risk**: Cron expressions confusing for non-technical users → **Mitigation**: Interactive wizard with preset options (daily/weekly/monthly) + visual cron builder
- **Risk**: Daemon consuming excessive resources → **Mitigation**: Nice process priority, memory limits, kill switch via `squeaky daemon stop --force`
- **Risk**: Automated cleanup breaks active development → **Mitigation**: Smart detection via file timestamps, exclude active project detection, conservative defaults
- **Risk**: Cross-platform daemon management complexity → **Mitigation**: Abstract platform differences behind unified API, extensive testing on all platforms
- **Risk**: Failed schedules causing support burden → **Mitigation**: Detailed logging, actionable error messages, self-healing (retry with backoff)
