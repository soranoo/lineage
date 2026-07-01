const globalA = 0;

function a(b: number, c: number): number {
  return c + 2 * b + globalA;
}

function b(c: number, d: number): number {
  return a(c, d);
}

function c(d: number, e: number): number {
  const t = d + 5;
  return b(t, e);
}

const result = c(5, 6);

export { result };
