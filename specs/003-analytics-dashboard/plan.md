# Implementation Plan: Analytics Dashboard

**Branch**: `003-analytics-dashboard` | **Date**: 2025-11-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-analytics-dashboard/spec.md`

**Note**: This plan is filled by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The Analytics Dashboard feature provides Professional and Team tier users with a web-based interface for visualizing cache cleanup history, analyzing trends, receiving optimization recommendations, and generating reports. The system persists cleanup data to SQLite, renders interactive charts using Chart.js, and serves a Svelte-based dashboard via Express on port 3200. Key value propositions include space savings visualization (ROI justification), cache growth projections (proactive optimization), and actionable recommendations (automated cleanup guidance).

**Technical Approach**: Lightweight embedded stack (Svelte + Chart.js + better-sqlite3 + Express) for offline-capable, zero-configuration analytics. Data collection integrated into existing cleanup operations with <5% overhead. Progressive enhancement from basic charts (P1) to trend analysis (P2) to recommendations engine (P3) to export/reporting (P4).

## Technical Context

**Language/Version**: TypeScript 5.x (matches existing project), Node.js 16.x+ (existing requirement)
**Primary Dependencies**:
- `better-sqlite3@^9.0.0` (embedded database, zero config)
- `express@^4.18.0` (web server for dashboard)
- `chart.js@^4.4.0` (chart rendering, 33KB minified)
- `svelte@^4.0.0` (frontend framework)
- `jspdf@^2.5.1` (PDF generation)
- `papaparse@^5.4.1` (CSV parsing/generation)

**Storage**: SQLite database at `~/.squeaky-clean/analytics.db` with tables: `cleanup_records`, `recommendations`

**Testing**: Vitest (existing framework), integration tests for SQLite operations, E2E tests for dashboard rendering

**Target Platform**: Cross-platform (macOS, Linux, Windows) - local web server accessible at localhost:3200

**Project Type**: Single project (extends existing CLI tool with embedded web server)

**Performance Goals**:
- Dashboard initial load < 2 seconds (1000 records)
- Chart rendering < 1 second (1000 data points)
- CSV export < 2 seconds (5000 records)
- PDF generation < 5 seconds (includes chart rendering)
- Data collection overhead < 5% of cleanup operation time

**Constraints**:
- Fully offline-capable (no CDN dependencies, all assets bundled)
- Zero external configuration (embedded SQLite, auto-port detection)
- Professional tier gating (license check before dashboard access)
- Browser compatibility: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- Responsive design: 1920px desktop, 768px tablet, 375px mobile

**Scale/Scope**:
- Support 10,000+ cleanup records per user
- Handle concurrent dashboard viewers (read-only)
- Team tier: Aggregate 50+ team members
- Export up to 5,000 records per operation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Note**: Project constitution is template-only. Applying inferred principles from existing codebase:

### I. Modular Architecture ✅
- Dashboard feature extends existing CLI without coupling
- Analytics service standalone, can be consumed by other features
- Database layer abstracted for testability

### II. TypeScript-First ✅
- All dashboard code in TypeScript matching project standard
- Type definitions for analytics entities (CleanupRecord, CacheTrend, etc.)
- Strict type checking enabled

### III. Test Coverage ✅
- Target: 85%+ coverage (matches existing project standard)
- Unit tests for analytics engine
- Integration tests for SQLite operations
- E2E tests for dashboard rendering

### IV. Cross-Platform Support ✅
- SQLite works across all platforms
- Express server platform-agnostic
- Path handling via Node.js `path` module
- No platform-specific file operations

### V. Security & Privacy ✅
- All data local-only (no phone-home)
- No user data transmission
- Dashboard accessible only on localhost
- Professional tier license validation

**Constitution Status**: ✅ PASSES - No violations identified

## Project Structure

### Documentation (this feature)

```text
specs/003-analytics-dashboard/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── analytics-api.openapi.yaml
│   └── database-schema.sql
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── analytics/           # NEW: Analytics dashboard feature
│   ├── database/
│   │   ├── schema.ts           # SQLite schema definitions
│   │   ├── migrations.ts       # Database migrations
│   │   └── repository.ts       # Data access layer
│   ├── engine/
│   │   ├── trend-analyzer.ts   # Cache growth analysis
│   │   ├── recommender.ts      # Optimization recommendations
│   │   └── aggregator.ts       # Stats aggregation
│   ├── server/
│   │   ├── app.ts              # Express application
│   │   ├── routes.ts           # API routes
│   │   └── middleware.ts       # Auth, CORS, error handling
│   ├── exporters/
│   │   ├── csv-exporter.ts     # CSV generation
│   │   └── pdf-exporter.ts     # PDF report generation
│   └── types.ts                # Analytics type definitions
├── commands/
│   ├── dashboard.ts     # NEW: `squeaky dashboard` command
│   └── analytics.ts     # NEW: `squeaky analytics` command
├── cleaners/
│   └── BaseCleaner.ts   # MODIFY: Add analytics data collection hook
└── utils/
    └── analytics.ts     # NEW: Helper for recording cleanup events

dashboard/               # NEW: Svelte frontend application
├── src/
│   ├── components/
│   │   ├── SpaceSavingsChart.svelte
│   │   ├── TrendAnalysis.svelte
│   │   ├── Recommendations.svelte
│   │   └── ExportDialog.svelte
│   ├── pages/
│   │   ├── Overview.svelte
│   │   ├── Trends.svelte
│   │   ├── Recommendations.svelte
│   │   └── Reports.svelte
│   ├── services/
│   │   ├── api-client.ts       # Dashboard API client
│   │   └── chart-config.ts     # Chart.js configuration
│   ├── stores/
│   │   └── analytics-store.ts  # Svelte stores for state
│   ├── App.svelte
│   └── main.ts
├── public/
│   └── index.html
├── package.json
├── vite.config.ts              # Vite build configuration
└── tsconfig.json

tests/
├── analytics/           # NEW: Analytics test suite
│   ├── unit/
│   │   ├── database.test.ts
│   │   ├── trend-analyzer.test.ts
│   │   ├── recommender.test.ts
│   │   └── exporters.test.ts
│   ├── integration/
│   │   ├── analytics-workflow.test.ts
│   │   └── dashboard-api.test.ts
│   └── e2e/
│       └── dashboard-ui.test.ts
└── fixtures/
    └── analytics-data.json      # Test data for 1000+ cleanup records
```

**Structure Decision**: Single project with new `/src/analytics` module and standalone `/dashboard` Svelte app. Dashboard builds to `/dist/dashboard` and is served by Express from embedded server. This follows existing CLI pattern while isolating dashboard frontend for independent builds.

## Complexity Tracking

> **No violations - this section intentionally empty per Constitution Check**
