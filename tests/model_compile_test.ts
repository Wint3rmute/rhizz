import { assert } from "jsr:@std/assert@^1.0.15";
import { rocket_model } from "../src/rocket.ts";
import { try_parse_model } from "../src/model-parser-utils.ts";

Deno.test("simple test", () => {
  const parsing_result = try_parse_model(rocket_model);
  assert(parsing_result);
  assert("components" in parsing_result);
});

