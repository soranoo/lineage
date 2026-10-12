import type {
  AbsolutePath,
  DependencyNode,
  ParsedFile,
  SliceResult,
  SourceText,
  TraceCacheOptions,
  TraceCacheStats,
  TrackerIssue,
} from "@/types";

/** Bound graph retention independently of the number of selected occurrences. */
const DEFAULT_MAX_ENTRIES = 128;
/** Estimated retained graph memory budget. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** Conservative bookkeeping allowance per graph record. */
const RECORD_BYTES = 128;
/** UTF-16 storage allowance per character. */
const CHARACTER_BYTES = 2;

/** A detached computed graph and the issues emitted by its crawl. */
export type CachedSliceTrace = {
  /** Complete dependency graph before output assembly. */
  slice: SliceResult;
  /** Slice issues only; file-wide issues are replayed separately for each request. */
  issues: TrackerIssue[];
};

/** One retained graph with its accounted weight. */
type CacheEntry = CachedSliceTrace & {
  /** Estimated graph and key bytes. */
  bytes: number;
};

/** Source identity that must remain unchanged while graphs are reusable. */
type SourceIdentity = {
  /** Exact source text. */
  source: SourceText;
  /** AST identity used for lexical binding resolution. */
  ast: ParsedFile["ast"];
};

/** Estimate graph retention without serializing another full copy.
 * @param key Lookup identity.
 * @param trace Graph and issues.
 * @returns Estimated bytes including object bookkeeping.
 */
const traceBytes = (key: string, trace: CachedSliceTrace): number => {
  let bytes = key.length * CHARACTER_BYTES + RECORD_BYTES;
  for (const node of trace.slice.nodes) {
    bytes +=
      RECORD_BYTES + CHARACTER_BYTES * (node.id.length + node.file.length + node.label.length);
  }
  for (const edge of trace.slice.edges) {
    bytes +=
      RECORD_BYTES + CHARACTER_BYTES * (edge.from.length + edge.to.length + edge.kind.length);
  }
  for (const id of trace.slice.visitedRanges) {
    bytes += RECORD_BYTES + CHARACTER_BYTES * id.length;
  }
  for (const issue of trace.issues) {
    bytes += RECORD_BYTES + CHARACTER_BYTES * (issue.file.length + issue.message.length);
  }
  return bytes;
};

/** Bounded LRU of computed graphs for one immutable parsed project snapshot. */
export class SliceTraceCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, CacheEntry>();
  private sources = new Map<AbsolutePath, SourceIdentity>();
  private bytes = 0;
  private peakEntries = 0;
  private peakBytes = 0;
  private hits = 0;
  private bindingHits = 0;
  private misses = 0;
  private evictions = 0;

  /** Configure graph retention; zero in either limit disables caching.
   * @param options Optional retention limits.
   */
  constructor(options: TraceCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    for (const limit of [this.maxEntries, this.maxBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new RangeError("Trace cache limits must be nonnegative safe integers.");
      }
    }
  }

  /** Check whether this tracker retains computed graphs.
   * @returns Whether both retention limits permit reuse.
   */
  readonly isEnabled = (): boolean => this.maxEntries > 0 && this.maxBytes > 0;

  /** Invalidate all graphs when any parsed file is added, removed, or replaced.
   * @param parsedFiles Complete parsed project for the current request.
   */
  readonly synchronize = (parsedFiles: ReadonlyMap<AbsolutePath, ParsedFile>): void => {
    if (!this.isEnabled()) {
      return;
    }
    if (
      this.sources.size === parsedFiles.size &&
      [...parsedFiles].every(([file, parsed]) => {
        const previous = this.sources.get(file);
        return previous?.source === parsed.source && previous.ast === parsed.ast;
      })
    ) {
      return;
    }
    this.entries.clear();
    this.bytes = 0;
    this.sources = new Map(
      [...parsedFiles].map(([file, parsed]) => [file, { source: parsed.source, ast: parsed.ast }]),
    );
  };

  /** Read a detached graph, optionally reattaching its start to a new occurrence.
   * @param key Exact selection or canonical binding identity.
   * @param start New occurrence's enclosing statement for binding reuse.
   * @returns Independent graph, or no safe reusable entry.
   */
  readonly read = (key: string, start?: DependencyNode): CachedSliceTrace | undefined => {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    const root = entry.slice.nodes.find((node) => node.kind === "start-point");
    if (
      start &&
      (!root || entry.slice.nodes.some((node) => node.id === start.id && node !== root))
    ) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    const result: CachedSliceTrace = structuredClone({ slice: entry.slice, issues: entry.issues });
    if (start && root) {
      this.bindingHits++;
      result.slice.nodes = result.slice.nodes.map((node) =>
        node.id === root.id ? { ...start, range: { ...start.range } } : node,
      );
      result.slice.edges = result.slice.edges.map((edge) => ({
        ...edge,
        from: edge.from === root.id ? start.id : edge.from,
        to: edge.to === root.id ? start.id : edge.to,
      }));
      result.slice.visitedRanges.delete(root.id);
      result.slice.visitedRanges.add(start.id);
    }
    return result;
  };

  /** Record a request that required a new dependency crawl. */
  readonly miss = (): void => {
    this.misses++;
  };

  /** Retain an independent computed graph, evicting least recently used entries.
   * @param key Source selection or canonical binding identity.
   * @param trace Completed graph and crawl issues.
   */
  readonly write = (key: string, trace: CachedSliceTrace): void => {
    if (!this.maxEntries || !this.maxBytes) {
      return;
    }
    const bytes = traceBytes(key, trace);
    if (bytes > this.maxBytes) {
      return;
    }
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
      this.evictions++;
    }
    this.entries.set(key, { ...structuredClone(trace), bytes });
    this.bytes += bytes;
    this.peakEntries = Math.max(this.peakEntries, this.entries.size);
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  };

  /** Inspect reuse and retention without exposing cached mutable data.
   * @returns Current cache counters and estimated memory use.
   */
  readonly stats = (): TraceCacheStats => ({
    hits: this.hits,
    bindingHits: this.bindingHits,
    misses: this.misses,
    entries: this.entries.size,
    bytes: this.bytes,
    peakEntries: this.peakEntries,
    peakBytes: this.peakBytes,
    evictions: this.evictions,
  });
}
