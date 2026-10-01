const globalA = 0;

// oxlint-disable-next-line func-style jsdoc-js/require-jsdoc
function a(b: number, c: number): number {
  return c + 2 * b + globalA;
}

// oxlint-disable-next-line func-style jsdoc-js/require-jsdoc
function b(c: number, d: number): number {
  return a(c, d);
}

// oxlint-disable-next-line func-style jsdoc-js/require-jsdoc
function c(d: number, e: number): number {
  const t = d + 5;
  return b(t, e);
}

const result = c(5, 6);

export { result };
