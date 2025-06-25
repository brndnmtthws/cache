# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a high-performance cache action for GitHub Actions that provides S3 backend support as a drop-in replacement for the official `actions/cache@v4`. It's designed to work with RunsOn self-hosted runners but can also be used with any infrastructure that has S3 access.

Key features:
- 200MiB/s+ throughput with S3 backend
- No size limits on caches (unlike GitHub's 10GB limit)
- Automatic fallback to GitHub's default cache when S3 isn't configured
- Full API compatibility with actions/cache@v4

## Development Commands

### Build
```bash
npm run build
```
Builds all four entry points using @vercel/ncc bundler. The output goes to `dist/` with separate folders for each entry point.

### Test
```bash
npm test                    # Run all tests with coverage
npm test -- path/to/test   # Run specific test file
```
Tests use Jest with TypeScript support. Network calls are mocked with nock.

### Lint & Format
```bash
npm run lint               # ESLint check
npm run format             # Prettier auto-format
npm run format-check       # Prettier check without modifying
```

### Type Check
```bash
tsc --noEmit              # TypeScript type checking (included in npm test)
```

## Architecture Overview

### Entry Points
The action has four entry points in `src/`:
- `restore.ts` - Main entry, used in action.yml as 'main'
- `save.ts` - Post-action hook, used in action.yml as 'post'
- `restoreOnly.ts` - Standalone restore without state tracking
- `saveOnly.ts` - Standalone save without state tracking

### Backend System
The codebase supports two backends:
1. **GitHub Cache Backend** - Default cache.restoreCache/saveCache from @actions/cache
2. **S3 Backend** - Custom implementation in `src/custom/` when RUNS_ON_S3_BUCKET_CACHE is set

Backend selection is automatic based on environment variables. The S3 backend mirrors the GitHub cache API interface for compatibility.

### Key Components
- **State Management**: `StateProvider` pattern handles state between restore/save steps
- **S3 Implementation**: Located in `src/custom/` with backend.ts, cache.ts, and downloadUtils.ts
- **Cache Keys**: S3 keys follow pattern: `cache/{repository}/{version}/{key}`
- **Version Calculation**: SHA256 hash of paths + compression + platform

### S3 Configuration
Controlled via environment variables:
- `RUNS_ON_S3_BUCKET_CACHE` - S3 bucket name (required for S3 backend)
- `RUNS_ON_S3_BUCKET_ENDPOINT` - Custom S3 endpoint (optional)
- `RUNS_ON_AWS_REGION` - AWS region
- `UPLOAD_QUEUE_SIZE` - Concurrent upload streams (default: 4)
- `UPLOAD_PART_SIZE` - Upload chunk size in MB (default: 32)
- `DOWNLOAD_QUEUE_SIZE` - Concurrent download streams (default: 8)
- `DOWNLOAD_PART_SIZE` - Download chunk size in MB (default: 16)

### Build Process
Uses @vercel/ncc to create self-contained JavaScript bundles. Each entry point is compiled separately to `dist/{restore,save,restore-only,save-only}/index.js`.

## Code Patterns

### Error Handling
- Validation errors propagate (action fails)
- Non-validation errors log warnings (action continues)
- Process exits with appropriate codes for GitHub Actions

### Testing
- Mock GitHub Actions environment with @actions/core
- Mock S3 operations for unit tests
- Use fixtures in `__tests__/fixtures/` for test data

### Cross-Platform Support
The `enableCrossOsArchive` option allows caches to work across Windows/Linux/macOS by using GNU tar format.