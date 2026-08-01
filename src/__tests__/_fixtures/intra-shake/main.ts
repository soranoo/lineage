export const compute = (x: number): number => {
  const log = `computing ${x}`;
  console.log(log);
  const doubled = x * 2;
  // oxlint-disable-next-line no-unused-vars
  const tripled = x * 3;
  return doubled;
};

export const result = compute(2);
