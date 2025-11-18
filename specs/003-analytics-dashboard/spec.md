# Feature Specification: Analytics Dashboard

**Feature Branch**: `003-analytics-dashboard`
**Created**: 2025-11-18
**Status**: Draft
**Input**: Professional/Team tier feature providing web-based analytics dashboard for cache usage trends, space savings visualization, and optimization recommendations

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Space Savings Visualization (Priority: P1)

A freelance developer wants to see a visual representation of how much disk space squeaky-clean has saved over time to justify the Professional tier subscription.

**Why this priority**: Core value demonstration - users need proof of ROI. Visual feedback drives continued usage and subscription retention. Primary differentiator for paid tiers.

**Independent Test**: Can be fully tested by running cleanups, accessing dashboard at `http://localhost:3200`, and verifying cumulative space saved chart displays correctly. Delivers standalone value of "savings visibility".

**Acceptance Scenarios**:

1. **Given** user has run 5+ cleanups, **When** accessing dashboard via `squeaky dashboard`, **Then** line chart shows cumulative space saved over time
2. **Given** dashboard displays data, **When** user hovers over data points, **Then** tooltip shows date, space saved, and tools cleaned
3. **Given** multiple tools cleaned, **When** viewing breakdown, **Then** pie chart shows space saved per tool (npm, docker, etc.)
4. **Given** user wants historical data, **When** selecting date range, **Then** chart updates to show only selected period

---

### User Story 2 - Cache Trend Analysis (Priority: P2)

A team lead wants to identify cache growth patterns across the team to optimize cleanup schedules and prevent disk space emergencies.

**Why this priority**: Proactive optimization - identifies problems before they cause issues. Essential for teams managing multiple developers. Builds on P1 visualization foundation.

**Independent Test**: Can be tested by collecting data over 14+ days, viewing trends page, and verifying growth rate calculations are accurate. Delivers value of "predictive insights".

**Acceptance Scenarios**:

1. **Given** 14+ days of data collected, **When** viewing trends page, **Then** cache growth rate displayed as GB/week per tool
2. **Given** rapid growth detected (>10GB/week), **When** trend analysis runs, **Then** alert badge displays "High Growth" with recommendation
3. **Given** cache size threshold approaching, **When** projection calculated, **Then** estimated "days until full" displayed
4. **Given** team data aggregated, **When** viewing team dashboard, **Then** per-developer statistics show top consumers

---

### User Story 3 - Optimization Recommendations (Priority: P3)

A developer wants personalized recommendations for improving cache efficiency based on their usage patterns.

**Why this priority**: Actionable insights drive behavior change. Nice-to-have intelligence that requires P1/P2 data collection. Increases perceived value of analytics.

**Independent Test**: Can be tested by running analysis engine, accessing recommendations page, and verifying suggestions match detected patterns. Delivers value of "automated optimization guidance".

**Acceptance Scenarios**:

1. **Given** analytics engine detects duplicate caches, **When** recommendations generated, **Then** suggestion to consolidate npm cache locations displayed
2. **Given** stale caches detected (>30 days unused), **When** recommendations shown, **Then** cleanup targets listed with potential space savings
3. **Given** user acknowledges recommendation, **When** clicking "Apply", **Then** cleanup command auto-generated and executable
4. **Given** recommendation actioned, **When** next analysis runs, **Then** recommendation marked as completed and removed from list

---

### User Story 4 - Export & Reporting (Priority: P4)

A team manager wants to export analytics data as CSV/PDF for monthly reports to justify tool costs to finance team.

**Why this priority**: Enterprise requirement for reporting. Nice-to-have for Professional, essential for Team/Enterprise. Enables data portability.

**Independent Test**: Can be tested by clicking export button, downloading file, and verifying data matches dashboard display. Delivers value of "portable analytics".

**Acceptance Scenarios**:

1. **Given** dashboard data displayed, **When** clicking "Export CSV", **Then** file downloads containing all cleanup records with timestamps and sizes
2. **Given** monthly view selected, **When** clicking "Export PDF Report", **Then** formatted PDF generated with charts and summary statistics
3. **Given** team analytics enabled, **When** exporting, **Then** per-user breakdowns included in export
4. **Given** export includes date range, **When** file opened, **Then** data filtered to selected period only

---

### Edge Cases

- What happens when no cleanup data exists yet? → Show empty state with "Run your first cleanup to see analytics" message and getting started guide
- How does system handle corrupted analytics database? → Automatic backup/restore mechanism, fallback to CSV exports if DB corrupted
- What if dashboard port (3200) is already in use? → Auto-detect and use next available port, display actual URL to user
- How are concurrent dashboard accesses handled? → Read-only access allows unlimited concurrent viewers, data updates queued
- What happens if disk space calculation API fails? → Cache last known values, display warning banner "Using cached data (updated X ago)"
- How does dashboard behave without internet connection? → Fully offline-capable, all assets bundled, no CDN dependencies
- What if chart rendering fails in older browsers? → Graceful degradation to table view, browser compatibility check on load

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide web-based dashboard accessible via `squeaky dashboard` command launching local server on port 3200
- **FR-002**: Dashboard MUST display cumulative space saved over time as line chart with date on X-axis and bytes on Y-axis
- **FR-003**: Dashboard MUST show space saved breakdown by tool as pie chart with percentages and absolute values
- **FR-004**: Dashboard MUST persist cleanup records to local database at `~/.squeaky-clean/analytics.db` using SQLite
- **FR-005**: System MUST record timestamp, tools cleaned, space saved, and duration for each cleanup operation
- **FR-006**: Dashboard MUST support date range filtering with presets: Last 7 days, Last 30 days, Last 90 days, All time, Custom
- **FR-007**: Dashboard MUST calculate cache growth rate as GB/week based on historical data (minimum 7 days required)
- **FR-008**: Dashboard MUST detect high growth patterns (>10GB/week) and display alert badges with severity levels
- **FR-009**: Dashboard MUST project "days until disk full" based on current growth rate and available disk space
- **FR-010**: Dashboard MUST provide recommendations page listing optimization suggestions sorted by impact (high/medium/low)
- **FR-011**: System MUST detect duplicate cache locations and recommend consolidation with estimated space savings
- **FR-012**: System MUST identify stale caches (>30 days unused) and list as cleanup targets with size estimates
- **FR-013**: Dashboard MUST generate one-click cleanup commands for each recommendation that copy to clipboard or execute directly
- **FR-014**: Dashboard MUST track recommendation completion status and remove from list when actioned
- **FR-015**: Dashboard MUST support CSV export of all cleanup records with columns: timestamp, tool, space_saved, duration
- **FR-016**: Dashboard MUST support PDF report generation including charts (as images), summary statistics, and date range
- **FR-017**: For Team tier, dashboard MUST aggregate team member data and display per-user statistics
- **FR-018**: For Team tier, dashboard MUST show top space consumers (users) and top cache types (tools) across team
- **FR-019**: Dashboard MUST render charts using lightweight library (Chart.js or D3.js subset) with responsive design
- **FR-020**: Dashboard MUST be fully offline-capable with all assets bundled (no CDN dependencies)
- **FR-021**: Dashboard MUST implement auto-refresh every 30 seconds for live data updates during active cleanups
- **FR-022**: Dashboard MUST provide dark mode toggle persisted to local storage
- **FR-023**: Dashboard MUST be responsive supporting desktop (1920px), tablet (768px), and mobile (375px) viewports
- **FR-024**: Dashboard MUST load initial view in under 2 seconds with 1000 cleanup records
- **FR-025**: Dashboard MUST handle database queries efficiently with indexes on timestamp and tool columns

### Key Entities

- **CleanupRecord**: Historical cleanup event with id (autoincrement), timestamp (Date), tools (JSON array), spaceSaved (bytes), duration (milliseconds), success (boolean)

- **CacheTrend**: Calculated trend data with tool (name), growthRate (bytes per week), lastSize (bytes), projectedFull (Date), severity (high/medium/low)

- **Recommendation**: Optimization suggestion with id (UUID), type (duplicate/stale/oversized), description (human-readable), impact (high/medium/low), potentialSavings (bytes), command (executable CLI command), completed (boolean), completedAt (Date)

- **DashboardStats**: Aggregated statistics with totalSpaceSaved (bytes), totalCleanups (count), averageSavings (bytes), mostCleanedTool (string), lastCleanup (Date)

- **TeamMemberStats** (Team tier): Per-user analytics with userId (string), userName (string), totalSpaceSaved (bytes), cleanupCount (number), topTools (array), lastActive (Date)

- **ExportRequest**: Report generation request with format (csv/pdf), dateRange (start/end), includeCharts (boolean), includeTeamData (boolean for Team tier)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Dashboard launches and displays initial view in under 3 seconds from command execution
- **SC-002**: Chart rendering completes in under 1 second for datasets up to 1000 records
- **SC-003**: Users can locate desired metric (total saved, growth rate, etc.) within 10 seconds of dashboard access
- **SC-004**: Recommendation engine identifies 80%+ of optimization opportunities based on manual analysis baseline
- **SC-005**: CSV export generates file in under 2 seconds for up to 5000 records
- **SC-006**: PDF report generation completes in under 5 seconds including chart rendering
- **SC-007**: Dashboard responsive design maintains usability on mobile devices (375px) with no horizontal scrolling
- **SC-008**: Professional tier users report 75%+ satisfaction with analytics features (6-month survey)
- **SC-009**: Team tier adoption reaches 60%+ of team members actively viewing dashboard weekly
- **SC-010**: Analytics data collection overhead adds <5% to cleanup operation duration
- **SC-011**: Dashboard browser compatibility verified on Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **SC-012**: Zero data loss events in analytics database across 10,000+ cleanup operations
- **SC-013**: Recommendation acceptance rate >40% (users acting on recommendations)
- **SC-014**: Dashboard uptime 99.9%+ (local server crashes <0.1% of launches)

### Technical Validation

- **TV-001**: Unit test coverage ≥85% for analytics engine and dashboard backend
- **TV-002**: Integration tests verify SQLite database operations (insert, query, export)
- **TV-003**: E2E tests validate chart rendering, filtering, and export functionality
- **TV-004**: Performance benchmarks confirm sub-2-second initial load with 1000 records
- **TV-005**: Security audit confirms no XSS vulnerabilities in dashboard rendering
- **TV-006**: Accessibility audit validates WCAG 2.1 Level AA compliance (keyboard nav, screen readers)

## Architecture & Implementation Notes

### Dashboard Stack

```
Frontend: Svelte (lightweight, fast compilation)
Charts: Chart.js (33KB minified, simple API)
Database: better-sqlite3 (embedded, zero config)
Server: Express.js (minimal server for static assets + API)
Export: jsPDF (PDF generation), PapaParse (CSV)
```

### Data Schema

```sql
CREATE TABLE cleanup_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  tools TEXT NOT NULL,  -- JSON array
  space_saved INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  success INTEGER DEFAULT 1
);

CREATE INDEX idx_timestamp ON cleanup_records(timestamp);
CREATE INDEX idx_tools ON cleanup_records(tools);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  impact TEXT NOT NULL,
  potential_savings INTEGER NOT NULL,
  command TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  completed_at INTEGER
);
```

### CLI Commands

- `squeaky dashboard` → Launch dashboard server on port 3200, open browser
- `squeaky dashboard --port 4000` → Custom port
- `squeaky dashboard --no-browser` → Server only, no auto-open
- `squeaky analytics export --format csv --range 30d` → Export last 30 days as CSV
- `squeaky analytics export --format pdf --range all` → Full history PDF report
- `squeaky analytics clear` → Clear all analytics data (confirmation prompt)

### Dependencies

- `better-sqlite3` (^9.0.0) → Embedded database
- `express` (^4.18.0) → Web server
- `chart.js` (^4.4.0) → Chart rendering
- `jspdf` (^2.5.1) → PDF generation
- `papaparse` (^5.4.1) → CSV parsing/generation
- `svelte` (^4.0.0) → Frontend framework

### Professional Tier Gating

- **Community (Free)**: CLI-only analytics via `squeaky stats` (basic text summary)
- **Professional ($15/mo)**: Full dashboard, charts, basic recommendations
- **Team ($99/mo)**: Team aggregation, per-user stats, advanced recommendations
- **Enterprise ($500+/mo)**: Custom dashboards, API access, data warehouse export

### Migration Path

**Phase 1** (Weeks 1-2): Database schema, data collection, basic stats
**Phase 2** (Weeks 3-4): Dashboard MVP with line/pie charts
**Phase 3** (Weeks 5-6): Trend analysis, growth projections, alerts
**Phase 4** (Weeks 7-8): Recommendations engine, export functionality
**Phase 5** (Week 8): Team features (Team tier), polish, documentation

## Open Questions

1. **Hosting**: Local-only dashboard or optional cloud sync for team collaboration? → **Decision**: Local-only v1, cloud sync v1.1 (reduces complexity, no hosting costs)
2. **Real-time updates**: WebSocket for live updates or polling? → **Decision**: Polling (simpler, works through firewalls)
3. **Historical data retention**: Keep all history or rolling window? → **Decision**: Keep all, provide manual clear command (users want full history)
4. **Chart library**: Chart.js (simple) or D3.js (powerful)? → **Decision**: Chart.js (lighter, 90% of use cases, easier maintenance)
5. **Team data sync**: Central server or peer-to-peer? → **Defer to Team tier v1.1**, not critical for MVP

## Risk Mitigation

- **Risk**: Dashboard performance degrades with large datasets → **Mitigation**: Pagination for table views, data sampling for charts (show last 90 days by default)
- **Risk**: SQLite database corruption → **Mitigation**: Automatic backups before writes, export to CSV for recovery
- **Risk**: Port conflicts (3200 in use) → **Mitigation**: Auto-detect next available port, display URL clearly
- **Risk**: Browser compatibility issues → **Mitigation**: Target modern browsers (2 years old), provide degraded table view for older browsers
- **Risk**: Users don't see value in analytics → **Mitigation**: Clear savings visualization, actionable recommendations, highlight cumulative savings prominently
- **Risk**: Privacy concerns about data collection → **Mitigation**: All data local-only, no phone-home, clear privacy statement, easy data deletion
