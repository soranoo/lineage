export const runEval = (input: number): number => {
  const local = input + 1;
  const value = eval("local");
  return value;
};

export const evalResult = runEval(2);