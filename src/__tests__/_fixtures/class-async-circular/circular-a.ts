import { valueB } from "./circular-b.ts";

export const valueA: number = valueB + 1;
export const circularResultA = valueA;
