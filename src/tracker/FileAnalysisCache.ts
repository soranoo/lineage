import type {
  AbsolutePath,
  DependencyFileAnalysis,
  ParsedFile,
  PreprocessingCacheStats,
  TraceCacheOptions,
} from "@/types";

/** Default file metadata retention independent of graph retention. */
const DEFAULT_MAX_ENTRIES = 128;
/** Default estimated metadata budget. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** UTF-16 estimate for retained strings. */
const CHARACTER_BYTES = 2;
/** Fixed entry bookkeeping estimate. */
const ENTRY_BYTES = 256;

/** Bounded LRU for module boundaries and file-wide issues from immutable parsed files. */
export class FileAnalysisCache {
  private readonly entries = new Map<AbsolutePath, DependencyFileAnalysis>();
  private readonly weights = new Map<AbsolutePath, number>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  /** Configure file metadata retention independently of the computed graph cache.
   * @param options Entry and estimated byte limits; zero disables reuse.
   * @throws RangeError When a limit is not a nonnegative safe integer.
   */
  constructor(options: TraceCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    for (const limit of [this.maxEntries, this.maxBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new RangeError("Preprocessing cache limits must be nonnegative safe integers.");
      }
    }
  }

  /** Reuse file metadata only while its exact source and AST identities match.
   * @param parsed Current parsed source.
   * @returns Internal immutable metadata, or undefined when analysis is needed.
   */
  readonly read = (parsed: ParsedFile): DependencyFileAnalysis | undefined => {
    const file = parsed.absolutePath;
    const cached = this.entries.get(file);
    if (cached?.source === parsed.source && cached.ast === parsed.ast) {
      this.entries.delete(file);
      this.entries.set(file, cached);
      this.hits++;
      return cached;
    }
    this.remove(file);
    this.misses++;
    return undefined;
  };

  /** Retain derived metadata without duplicating the shared source or AST.
   * @param file Parsed file identity.
   * @param analysis Completed file analysis; never mutated after retention.
   */
  readonly write = (file: AbsolutePath, analysis: DependencyFileAnalysis): void => {
    if (!this.maxEntries || !this.maxBytes) {
      return;
    }
    const bytes =
      ENTRY_BYTES +
      CHARACTER_BYTES *
        (file.length +
          JSON.stringify([analysis.dependencies, analysis.moduleCalls, analysis.issues]).length);
    this.remove(file);
    if (bytes > this.maxBytes) {
      return;
    }
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.remove(oldest);
      this.evictions++;
    }
    this.entries.set(file, analysis);
    this.weights.set(file, bytes);
    this.bytes += bytes;
  };

  /** Remove retained metadata and its estimated weight.
   * @param file Cache key to release.
   */
  private readonly remove = (file: AbsolutePath): void => {
    this.bytes -= this.weights.get(file) ?? 0;
    this.weights.delete(file);
    this.entries.delete(file);
  };

  /** Inspect preprocessing reuse without exposing retained mutable metadata.
   * @returns Detached counters and current estimates.
   */
  readonly stats = (): PreprocessingCacheStats => ({
    hits: this.hits,
    misses: this.misses,
    entries: this.entries.size,
    bytes: this.bytes,
    evictions: this.evictions,
  });
}
