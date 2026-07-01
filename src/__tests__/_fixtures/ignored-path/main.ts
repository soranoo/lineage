import { assertNever as externalValue } from "assert-never";

import { schemaValue } from "./generated/schema.ts";

const input = 3;

export const parsed = schemaValue + input;
export const external = externalValue;