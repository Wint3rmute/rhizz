import { test } from "node:test";
import assert from "node:assert";
import { rocket_model } from "../src/rocket.ts";
import { try_parse_model } from "../src/model-parser-utils.ts";
import { graph } from "../src/model-visualizer.ts";
import * as Viz from "@viz-js/viz";

test("parse & render a model", async () => {
  const parsing_result = try_parse_model(rocket_model);
  assert.ok(parsing_result);
  assert.ok("components" in parsing_result);
  const output = graph(parsing_result);
  assert.ok(output);
  const viz = await Viz.instance();
  assert.ok(viz);

  const rendered_graph = viz.renderString(output);
  assert.ok(rendered_graph);
});
