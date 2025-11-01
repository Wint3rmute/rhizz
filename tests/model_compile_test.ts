import { assert } from "@std/assert";
import { rocket_model } from "../src/rocket.ts";
import { try_parse_model } from "../src/model-parser-utils.ts";
import { graph } from "../src/model-visualizer.ts";
import * as Viz from "@viz-js/viz";

Deno.test("parse & render a model", async () => {
  const parsing_result = try_parse_model(rocket_model);
  assert(parsing_result);
  assert("components" in parsing_result);
  const output = graph(parsing_result);
  assert(output);
  const viz = await Viz.instance();
  assert(viz);

  const rendered_graph = viz.renderString(output);
  assert(rendered_graph);
});
