import { add } from "./math.ts";
import { format } from "./index.ts";

const x = 5;
const y = 10;
const ignored = 999;

export const result = add(x, y);
export const label = format("hello");

export { ignored };