export const runEval = (input: number): number => {
  // oxlint-disable-next-line no-unused-vars
  const local = input + 1;
  // oxlint-disable-next-line no-eval
  const value = eval("local");
  return value;
};

export const evalResult = runEval(2);
