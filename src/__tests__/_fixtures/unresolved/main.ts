// @ts-nocheck
const a = 1;
const b = 2;
const c = 3;

export const subExprResult = (a + b) * transform(c);

const value = 2;

export const unresolvedResult = missingTransform(value);
