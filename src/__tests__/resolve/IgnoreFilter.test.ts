import { describe, expect, it } from "vitest";

import type { AbsolutePath } from "@/types";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";

class CountingRegExp extends RegExp {
  count = 0;

  override test(value: string): boolean {
    this.count += 1;
    return super.test(value);
  }
}

describe("IgnoreFilter", () => {
  it("always matches node_modules implicitly", () => {
    const filter = new IgnoreFilter([]);
    const path: AbsolutePath = "/project/node_modules/pkg/index.js";

    expect(filter.match(path)).toBe("node_modules");
  });

  it("matches string patterns by substring", () => {
    const filter = new IgnoreFilter(["generated"]);
    const path: AbsolutePath = "/project/src/generated/file.ts";

    expect(filter.match(path)).toBe("generated");
  });

  it("does not match string patterns when absent", () => {
    const filter = new IgnoreFilter(["generated"]);
    const path: AbsolutePath = "/project/src/app/file.ts";

    expect(filter.match(path)).toBeNull();
  });

  it("matches RegExp patterns", () => {
    const pattern = /fixtures/;
    const filter = new IgnoreFilter([pattern]);
    const path: AbsolutePath = "/project/src/fixtures/sample.ts";

    expect(filter.match(path)).toBe(pattern);
  });

  it("does not match RegExp patterns when absent", () => {
    const filter = new IgnoreFilter([/ignored/]);
    const path: AbsolutePath = "/project/src/app/file.ts";

    expect(filter.match(path)).toBeNull();
  });

  it("returns the first matching pattern", () => {
    const filter = new IgnoreFilter(["foo", /bar/]);
    const path: AbsolutePath = "/project/foo/bar/file.ts";

    expect(filter.match(path)).toBe("foo");
  });

  it("returns null when no patterns match", () => {
    const filter = new IgnoreFilter(["foo", /bar/]);
    const path: AbsolutePath = "/project/baz/file.ts";

    expect(filter.match(path)).toBeNull();
  });

  it("uses compiled patterns without re-instantiating RegExp", () => {
    const pattern = new CountingRegExp("match");
    const filter = new IgnoreFilter([pattern]);
    const path: AbsolutePath = "/project/match/file.ts";

    filter.match(path);
    filter.match(path);

    expect(pattern.count).toBe(2);
  });
});
