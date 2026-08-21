function configure(options: Record<string, number>): void {
  const cache: Record<string, Record<string, number>> = {};
  cache.settings = options;
  registerCache(cache);
}

function registerCache(cache: Record<string, Record<string, number>>): void {
  console.log(cache);
}

configure({ enabled: 1 });