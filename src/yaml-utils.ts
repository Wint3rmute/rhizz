import * as yaml from "js-yaml";

export function try_load_yaml(input: string): object | yaml.YAMLException {
  try {
    const doc: object = yaml.load(input) as object;
    return doc;
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      console.log("YAML Exception!");
      return e;
    } else {
      throw e;
    }
  }
}
