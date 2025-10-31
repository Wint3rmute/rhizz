import { assertEquals, assert } from "jsr:@std/assert";
import { rocket_model } from "../src/rocket.ts";
import { try_parse_model } from "../src/model-parser-utils.ts";
import { SystemModelSchema, type SystemModel } from "../src/model-syntax.ts";
import { ModelCompilationError } from "../src/model-compiler.ts";

Deno.test("simple test", () => {
  const parsing_result = try_parse_model(rocket_model);
  assert(parsing_result);
  assert("components" in parsing_result);
});

