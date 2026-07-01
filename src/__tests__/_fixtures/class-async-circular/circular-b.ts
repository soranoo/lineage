import { valueA } from "./circular-a.ts";

export const valueB: number = valueA + 1;
export const circularResultB = valueB;