import { test } from "node:test";
import assert from "node:assert";
import { rocket_model } from "../src/rocket.ts";
import { ModelParsingSuccess, try_parse_model } from "../src/model-parser-utils.ts";
import { graph } from "../src/model-visualizer.ts";
import * as Viz from "@viz-js/viz";

test("parse & render a model", async () => {
  const parsing_result = try_parse_model(rocket_model);
  assert.ok(parsing_result instanceof ModelParsingSuccess, "Parsing result should be a ModelParsingSuccess");
  if (parsing_result instanceof ModelParsingSuccess === false) {
    throw new Error("Parsing failed");
  }
  const output = graph(parsing_result.model);
  assert.ok(output, "Graph output should be generated");
  const viz = await Viz.instance();
  assert.ok(viz, "Viz instance should be created");

  const rendered_graph = viz.renderString(output);
  assert.ok(rendered_graph, "Graph should be rendered");
});
