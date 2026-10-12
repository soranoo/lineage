// oxlint-disable-next-line func-style jsdoc-js/require-jsdoc
function configure(options: Record<string, number>): void {
  const cache: Record<string, Record<string, number>> = {};
  cache.settings = options;
  registerCache(cache);
}

// oxlint-disable-next-line func-style jsdoc-js/require-jsdoc
function registerCache(cache: Record<string, Record<string, number>>): void {
  console.log(cache);
}

configure({ enabled: 1 });
