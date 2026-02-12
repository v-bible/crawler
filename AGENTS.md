# Agent Workflow Guidelines

## Code Conventions

### Naming Conventions

**Consistency is critical.** Always follow existing naming patterns in the codebase:

#### TypeScript/JavaScript

- **Variables and Parameters**: Use `camelCase`
  - ✅ `metadataList`, `chapterParams`, `baseDir`
  - ❌ `metadata_list`, `chapter-params`, `BaseDir`

- **Constants**: Use `UPPER_SNAKE_CASE`
  - ✅ `DEFAULT_OUTPUT_FILE_DIR`, `DEFAULT_CRAWL_TIMEOUT_MS`
  - ❌ `defaultOutputFileDir`, `defaultCrawlTimeoutMs`

- **Types and Interfaces**: Use `PascalCase`
  - ✅ `Metadata`, `ChapterParams`, `PageContent`
  - ❌ `metadata`, `chapterParams`, `page_content`
  - **Prefer `type` over `interface`** for better composability and type inference
  - Use `interface` only when declaration merging or extending classes is needed
  - **Avoid type bloating** - reuse existing types instead of creating duplicates
  - **Use intersection types (`&`)** for composition: `type Extended = Base & Additional`
  - **Extract types from Zod schemas** using `z.infer<typeof Schema>` rather than duplicating definitions
  - Example of good type composition:

    ```typescript
    // ✅ Good - reuse and compose
    type TransformOptions = { normalizeShape?: boolean; precision?: number };
    type EnhancementOptions = TransformOptions & { sortVertical?: string };

    // ❌ Bad - duplicate fields
    type EnhancementOptions = {
      normalizeShape?: boolean;
      precision?: number;
      sortVertical?: string;
    };
    ```

- **Functions**: Use `camelCase`
  - ✅ `getChapters`, `getPageContent`, `writeChapterContent`
  - ❌ `get_chapters`, `GetPageContent`

#### File and Directory Naming

- **Site Scraper Directories**: Use domain name as-is
  - Format: `sites/{domain-name}/`
  - ✅ `sites/augustino.net/`, `sites/conggiao.org/`
  - ❌ `sites/augustinoNet/`, `sites/cong-giao-org/`

- **Scraper Files**: Descriptive camelCase names
  - ✅ `getChapters.ts`, `getPageContent.ts`, `getPageContentMd.ts`
  - ❌ `get_chapters.ts`, `GetPageContent.ts`

- **Test Fixtures**: Use descriptive lowercase names with hyphens
  - Format: `{source}_{description}.{ext}`
  - ✅ `augustino_chapter_list.html`, `conggiao_page_content.json`
  - ❌ `augustinoChapterList.html`

### Project Structure Conventions

- **CLI Commands**: Built using Stricli framework in `src/bin/` and `src/commands/`
  - `src/bin/cli.ts` - CLI entry point with `run()` function
  - `src/bin/bash-complete.ts` - Bash completion script
  - `src/commands/{command-name}/` - Command definitions and implementations
  - Pattern: Split into `command.ts` (CLI definition) and `impl.ts` (implementation)
  - Use `buildCommand` with loader pattern for lazy loading
  - Functions use `this: LocalContext` for context binding (not parameters)
  - Context defined in `src/context.ts` with `buildContext()` function

- **Site Registry**: Dynamic crawler imports in `src/sites/registry.ts`
  - Maps site names to async crawler factory functions
  - Allows CLI to load crawlers on demand
  - Export `AVAILABLE_SITES` array and `siteRegistry` object
  - Pattern: `siteRegistry[siteName]()` returns crawler instance

- **Site Scrapers**: Each site has its own directory under `src/sites/`
  - Structure: `src/sites/{domain-name}/main.ts` and helper files
  - `main.ts` exports crawler instance AND supports direct execution
  - Use `if (import.meta.url === \`file://\${process.argv\[1]}\`)`for ES modules (not`require.main === module`)
  - Helper files: `getChapters.ts`, `getPageContent.ts`, `getPageContentMd.ts`
  - Follow consistent patterns across all site scrapers

- **Library Functions**: Core functionality in `src/lib/`
  - `crawler/` - Crawler framework and utilities
  - `md/` - Markdown processing utilities
  - `ner/` - Named entity recognition utilities
  - Keep implementation modular and reusable

- **Constants**: Centralized in `src/constants.ts`
  - **ALL default values MUST be defined as constants**
  - **ALL path configurations MUST use constants**
  - **ALL timeout values MUST be defined as constants**
  - Group related constants together (paths, timeouts, defaults)
  - Document defaults clearly with comments
  - Use const assertions (`as const`) where appropriate
  - **ES Module compatibility**: Use `fileURLToPath(import.meta.url)` for `__dirname` polyfill
  - Examples:
    - `DEFAULT_METADATA_FILE_PATH` - Default metadata CSV path
    - `DEFAULT_OUTPUT_FILE_DIR` - Default corpus output directory
    - `DEFAULT_TASK_DIR` - Default task data directory
    - `DEFAULT_CRAWL_TIMEOUT_MS` - Timeout for page crawling
    - `DEFAULT_CHECKPOINT_DIR` - Default checkpoint directory
    - `DEFAULT_CHECKPOINT_FILE_PATH` - Default checkpoint file path

- **Checkpoint Functions**: Export from `src/lib/crawler/crawler.ts`
  - All checkpoint filter/sort functions in one place
  - Reusable across all site scrapers
  - ✅ `defaultFilterCheckpoint`, `defaultSortCheckpoint`
  - ✅ `filterNonChapterCheckpoint`, `filterChapterCheckpoint`
  - Import in site `main.ts` files as needed

### Schema and Type Management

**Use Zod as the single source of truth for runtime validation and type definitions:**

- **Define schemas in `src/lib/schema.ts`** using Zod
- **Extract TypeScript types** from schemas using `z.infer<typeof Schema>`
- **Never duplicate type definitions** - if a schema exists, use `z.infer`
- **Reuse schema fragments** - extract common schemas and compose with `z.union`, `z.intersection`, etc.

**Type Composition Best Practices:**

- **Use intersection types (`&`)** to combine types rather than duplicating fields
- **Create base types** for shared fields and extend with specific fields
- **Colocate related types** in the same file or module
- **Document type purposes** with comments when the purpose isn't obvious

**Examples:**

```typescript
// ✅ Good - Schema-first approach
const UserSchema = z.object({ name: z.string(), age: z.number() });
type User = z.infer<typeof UserSchema>; // Extract type from schema

// ✅ Good - Reuse and compose with intersection
type BaseOptions = { format?: string; verbose?: boolean };
type ConvertOptions = BaseOptions & { outputDir: string };
type EnhanceOptions = BaseOptions & { sortOrder?: string };

// ✅ Good - Extract and reuse schema fragments
const PointSchema = z.array(z.number());
const PolygonValueSchema = z.object({
  points: z.array(PointSchema),
  closed: z.boolean(),
});

// ❌ Bad - Duplicate type definition when schema exists
const UserSchema = z.object({ name: z.string(), age: z.number() });
type User = { name: string; age: number }; // Duplicates schema definition

// ❌ Bad - Duplicate fields instead of composing
type ConvertOptions = { format?: string; verbose?: boolean; outputDir: string };
type EnhanceOptions = {
  format?: string;
  verbose?: boolean;
  sortOrder?: string;
};
```

**When to use `interface` vs `type`:**

- **Default: use `type`** for all type aliases, unions, intersections
- **Use `interface`** only when:
  - You need declaration merging (rare in application code)
  - You're extending a class
  - You're defining a contract for a plugin system

### Preferred Dependencies and Utilities

**Always use these libraries when applicable:**

- **Zod** - Use for all runtime validation and schema definitions
  - Define schemas in `src/lib/schema.ts`
  - Extract types with `z.infer<typeof Schema>`
  - Prefer Zod validation over manual type checking
  - Use Zod for parsing CLI inputs, file data, and API responses
  - Example: `const result = MySchema.safeParse(data)` instead of manual validation

- **es-toolkit** - Use for all utility functions instead of lodash or custom implementations
  - Array operations: `chunk`, `uniq`, `groupBy`, `partition`, `shuffle`
  - Object operations: `pick`, `omit`, `mapKeys`, `mapValues`, `cloneDeep`
  - String operations: `camelCase`, `snakeCase`, `kebabCase`, `capitalize`
  - Function operations: `debounce`, `throttle`, `once`, `memoize`
  - Type guards: `isPlainObject`, `isNil`, `isEmpty`, `isEqual`
  - ✅ `import { chunk, uniq } from 'es-toolkit'`
  - ❌ Writing custom utility functions that es-toolkit provides
  - ❌ Using lodash when es-toolkit has equivalent functionality

- **Stricli** - Use for building CLI applications
  - Use `buildCommand`, `buildRouteMap`, `buildApplication` pattern
  - Command definitions in `command.ts` with loader pattern
  - Implementations in `impl.ts` with `this: LocalContext` binding
  - Use `proposeCompletions` for bash completion (not `buildBashCompletionScript`)
  - Context created with `buildContext(process)` function
  - Example patterns in label-studio-converter reference project

**Examples:**

```typescript
// ✅ Good - Using Zod for validation
const ConfigSchema = z.object({
  outDir: z.string(),
  recursive: z.boolean().default(false),
});
const config = ConfigSchema.parse(userInput);

// ✅ Good - Using es-toolkit utilities
import { chunk, uniq, groupBy } from 'es-toolkit';
const uniqueItems = uniq(items);
const batches = chunk(items, 10);
const grouped = groupBy(items, (item) => item.category);

// ✅ Good - Stricli command with loader pattern
export const crawlCommand = buildCommand({
  loader: async () => {
    const { crawl } = await import('./impl');
    return crawl;
  },
  parameters: {
    flags: {
      site: flags.string({
        brief: 'Site to crawl',
        default: 'all',
      }),
    },
  },
});

// ✅ Good - Implementation with context binding
export async function crawl(
  this: LocalContext,
  flags: { site: string; timeout?: number; verbose?: boolean },
): Promise<void> {
  // Implementation
}

// ❌ Bad - Manual validation when Zod should be used
if (typeof config.outDir !== 'string') throw new Error('Invalid outDir');

// ❌ Bad - Custom utility when es-toolkit provides it
const uniqueItems = [...new Set(items)]; // Use uniq() instead
const chunks = []; // Use chunk() instead
for (let i = 0; i < items.length; i += 10) {
  chunks.push(items.slice(i, i + 10));
}
```

### ES Module Compatibility

**This project uses ES modules (`"type": "module"` in package.json):**

- **Use `import.meta.url` instead of `require.main === module`**:

  ```typescript
  // ✅ Good - ES module main check
  if (import.meta.url === `file://${process.argv[1]}`) {
    main();
  }

  // ❌ Bad - CommonJS (won't work)
  if (require.main === module) {
    main();
  }
  ```

- **Use `fileURLToPath` for `__dirname` polyfill**:

  ```typescript
  // ✅ Good - ES module __dirname
  import { fileURLToPath } from 'url';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // ❌ Bad - CommonJS __dirname (won't work)
  const PROJECT_ROOT = path.resolve(__dirname, '..');
  ```

- **Use `.cjs` extension for CommonJS config files**:
  - ✅ `.eslintrc.cjs` - CommonJS config file
  - ❌ `.eslintrc.js` - Will be treated as ES module

### Adding New Site Scrapers

When adding a new site scraper, ensure consistency:

1. **Follow Existing Patterns**:
   - Look at similar scrapers (e.g., `conggiao.org/main.ts`) for structure
   - Match parameter order and Crawler configuration
   - Use the same error handling approach
   - **Check if es-toolkit provides utilities you need** before writing custom code

2. **Create Site Directory Structure**:
   - Create `src/sites/{domain-name}/` directory
   - Add `main.ts` with Crawler instance
   - Add helper files: `getChapters.ts`, `getPageContent.ts`, `getPageContentMd.ts` (as needed)
   - Use consistent function signatures across all helpers

3. **Reuse Checkpoint Functions**:
   - Import from `@/lib/crawler/crawler`
   - Use `defaultFilterCheckpoint`, `defaultSortCheckpoint` when appropriate
   - Create custom filters only when needed
   - Example: `filterNonChapterCheckpoint` for single-page documents

4. **Update Site Registry**:
   - Add site to `src/sites/registry.ts`
   - Export site name in `AVAILABLE_SITES` array
   - Add async factory function to `siteRegistry` object
   - Example: `'thanhlinh.net': async () => (await import('./thanhlinh.net/main')).crawler`

5. **Update Metadata**:
   - Add entries to `data/main.tsv` for new site
   - Set correct `source` field matching domain name
   - Configure `hasChapters`, `requiresManualCheck` flags

6. **Maintain Semantic Clarity**:
   - Choose names that clearly describe purpose
   - Prefer `chapterParams` over `params` (more semantic)
   - Prefer `resourceHref` over `url` or `link` (consistent with framework)

## Development Workflow

When implementing new features or making changes, follow this systematic approach:

### 1. Code Implementation

- Implement the requested feature with clean, maintainable code
- Follow existing code patterns and conventions
- Use TypeScript best practices
- Ensure proper error handling

### CRITICAL: Always Use Real Fixture Files

**NEVER use artificial test data when real fixtures exist.**

- The `test/fixtures/` directory contains REAL data exported from actual scrapers and tools
- **When writing tests**:
  - ✅ Use actual fixture file paths from test/fixtures/
  - ✅ Reference real HTML/JSON exports from scraped sites
  - ❌ NEVER use fake paths like `'test.json'` or `'test.html'`
  - ❌ NEVER create artificial test data when fixtures exist

- **Respect the effort**: These fixtures represent real data from production scraping runs. Use them properly.

- **Page Content Fixtures**:
  - HTML files preserve actual site structure
  - JSON files contain validated schema-compliant data
  - Do NOT modify fixture files unless they are incorrect

### 2. Quality Checks (Run ALL Before Completion)

**Build and Type Check:**

```bash
pnpm run build
```

- Ensures TypeScript compilation succeeds
- Validates type safety across the codebase

**ESLint:**

```bash
pnpm run lint
```

- Checks code style and quality
- Use `pnpm run lint:fix` for auto-fixable issues
- Fix ALL linting errors before proceeding

**Tests:**

```bash
pnpm test:run
```

- Run all test suites
- Ensure ALL tests pass
- Add new tests for new features
- Update existing tests if behavior changes

**Quick Check All:**

```bash
pnpm run validate
```

- Runs type-check, format:check, lint, and tests in one command

### 3. Documentation Updates

**README.md:**

- Update usage examples if API changes
- Add documentation for new scrapers or features
- Document metadata schema changes
- Keep scraper patterns documented

**IMPORTANT:**

- **DO NOT** create separate markdown files for documentation unless explicitly requested
- **DO NOT** create CHANGES.md, UPDATES.md, or similar summary files
- Update README.md directly with new information
- Keep documentation concise and focused

### 4. Test Coverage

**Ensure comprehensive testing:**

- Use ALL test fixtures available in `test/fixtures/`
- Test both success and error cases
- Test edge cases (empty data, missing fields, malformed HTML, etc.)
- Verify schema validation with Zod
- Test all site scraper variations

### 5. Completion Checklist

Before marking work as complete:

- [ ] ✅ Build succeeds (`pnpm run build`)
- [ ] ✅ Type checking passes (`pnpm run type-check`)
- [ ] ✅ ESLint passes with no errors (`pnpm run lint`)
- [ ] ✅ All tests pass (`pnpm test:run`)
- [ ] ✅ README.md updated with new features
- [ ] ✅ No unnecessary documentation files created
- [ ] ✅ Code follows existing patterns
- [ ] ✅ Exports updated in lib/index.ts if needed

## Project Structure

### This is a Web Scraping Framework with CLI

**Core Components:**

- **CLI Interface** - Built with Stricli in `src/bin/` and `src/commands/`
- **Crawler Framework** - Generic web scraping engine in `src/lib/crawler/`
- **Site Scrapers** - Domain-specific implementations in `src/sites/`
- **NER Processing** - Named entity recognition tools in `src/ner-processing/`
- **Markdown Tools** - Content processing utilities in `src/lib/md/`

### Key Directories

- `src/bin/` - CLI entry points (cli.ts, bash-complete.ts)
- `src/commands/` - CLI command implementations
- `src/context.ts` - CLI context definition
- `src/app.ts` - Application routes and configuration
- `src/sites/` - Site-specific scraper implementations
- `src/sites/registry.ts` - Site registry for dynamic imports
- `src/lib/crawler/` - Core crawler framework and utilities
- `src/lib/md/` - Markdown processing utilities
- `src/lib/ner/` - Named entity recognition utilities
- `src/ner-processing/` - NER task processing tools
- `data/` - Metadata and configuration files
- `dist/` - Output directory for scraped content

### Naming Conventions

**Test Fixtures:**

- Use descriptive, lowercase names with underscores
- Format: `{source}_{description}.{ext}`
- Examples: `augustino_chapter_list.html`, `conggiao_page_content.json`

## Common Tasks

### Adding New CLI Commands

1. Create command directory in `src/commands/`
2. Create `command.ts` with command definition using `buildCommand`
3. Create `impl.ts` with implementation using `this: LocalContext` pattern
4. Register in `src/app.ts` routes
5. Add tests for command functionality
6. Update README.md with usage examples

### Adding New Site Scrapers

1. Create site directory in `src/sites/{domain-name}/`
2. Implement `main.ts` with Crawler configuration
3. Export crawler instance for CLI usage
4. Add ES module main check for direct execution
5. Add helper files as needed: `getChapters.ts`, `getPageContent.ts`, `getPageContentMd.ts`
6. Import and reuse checkpoint functions from `@/lib/crawler/crawler`
7. Register site in `src/sites/registry.ts`
8. Add metadata entries to `data/main.tsv`
9. Test with real pages and add fixtures

### Adding New Library Functions

1. Implement in appropriate `src/lib/` directory
2. Add TypeScript types/interfaces
3. Write tests with real fixtures
4. Document in README.md if public API

### Schema Changes

1. Update schemas in `src/lib/crawler/schema.ts` or `src/lib/ner/schema.ts`
2. Run tests to verify compatibility
3. Update type definitions if needed
4. Document breaking changes in README.md

## Error Handling

Always provide clear error messages:

- Validation errors should indicate what's wrong
- File errors should include file paths
- Schema errors should show which field failed
- Use Zod's `z.prettifyError()` for validation errors

## Performance Considerations

- Process files in batches when possible
- Use streaming for large files
- Avoid loading entire datasets into memory
- Use async/await for I/O operations

## Module Organization

### Do NOT Re-export Utilities

**Forbidden pattern:**

```typescript
// ❌ BAD - Do not re-export utilities from barrel files
export { sortCheckpointAsc, sortCheckpointDesc } from './sortUtils';
export { defaultFilterCheckpoint } from './filterUtils';
```

**Correct pattern:**

```typescript
// ✅ GOOD - Import utilities directly where needed
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { defaultFilterCheckpoint } from '@/lib/crawler/filterUtils';
```

**Rationale:**

- Each utility file should be imported directly where it's used
- Avoids circular dependencies and import confusion
- Makes dependencies explicit and traceable
- Easier to understand what code depends on what

## Remember

1. **Quality over speed** - Take time to do it right
2. **Test everything** - Use all fixtures, test edge cases
3. **Document as you go** - Update README.md immediately
4. **Keep it simple** - Don't create unnecessary files
5. **Follow patterns** - Match existing code style
6. **No re-exports** - Import utilities directly from their source files
