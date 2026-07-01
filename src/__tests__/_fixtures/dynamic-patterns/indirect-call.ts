const getF = (): (() => number) => () => 1;
const f = getF();

export const indirectResult = f();
