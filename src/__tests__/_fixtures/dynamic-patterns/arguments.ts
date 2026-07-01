// @ts-nocheck
const pickFirst = (a: number, b: number): number => {
  return arguments[0] + arguments[1];
};

const first = 1;
const second = 2;

export const argumentsResult = pickFirst(first, second);
