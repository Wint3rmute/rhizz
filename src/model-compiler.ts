import * as syntax from "./model-syntax.ts";
import * as semantics from "./model-semantics.ts";

export function compile(model: syntax.SystemModel) : semantics.SystemModel {
  
  return {
    name: model.name,
    components_index: {},
    protocols: []
  }
}
