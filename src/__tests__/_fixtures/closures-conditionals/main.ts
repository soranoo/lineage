const rate = 0.2;
const unused = 123;

export const makeTaxer = () => {
  return (amount: number): number => amount * rate;
};

const taxer = makeTaxer();

export const tax = taxer(100);

const valueA = 10;
const valueB = 20;
const unusedConditional = 999;

const choose = (flag: boolean): number => {
  return flag ? valueA : valueB;
};

export const picked = choose(true);

export { unused, unusedConditional };