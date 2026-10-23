import { describe, expect, it } from "vitest";
import {
  asTestScript,
  createActionLog,
  encodeCall,
  type ModelAction,
} from "./actionLog";

describe("actionLog", () => {
  it("records actions in order and clears", () => {
    const log = createActionLog();
    expect(log.actions()).toEqual([]);
    log.record({ op: "add_system", label: "main", full_name: "" });
    log.record({ op: "add_system", label: "backup", full_name: "" });
    expect(log.actions().map((a) => a.op)).toEqual([
      "add_system",
      "add_system",
    ]);
    log.clear();
    expect(log.actions()).toEqual([]);
  });

  it("encodes an add_system call as a dispatcher op", () => {
    expect(
      encodeCall(
        { op: "add_system", label: "main", full_name: "A system" },
        "fs",
      ),
    ).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"add_system","label":"main","full_name":"A system"});',
    );
  });

  it("encodes an add_component_definition call with options JSON", () => {
    const action: ModelAction = {
      op: "add_component_definition",
      label: "drone",
      leaf: true,
      full_name: "",
      tags: [],
      ports: [],
    };
    expect(encodeCall(action, "fs")).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"add_component_definition","label":"drone","options":{"leaf":true,"full_name":"","tags":[],"ports":[]}});',
    );
  });

  it("encodes an update_component call with a patch", () => {
    const action: ModelAction = {
      op: "update_component",
      path: "main/drone",
      patch: {
        full_name: "A quadcopter",
        tags: ["power", "flight"],
        leaf: true,
      },
    };
    expect(encodeCall(action, "fs")).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"update_component","path":"main/drone","patch":{"full_name":"A quadcopter","tags":["power","flight"],"leaf":true}});',
    );
  });

  it("encodes delete_connection via the by-label op", () => {
    expect(
      encodeCall(
        {
          op: "delete_connection",
          scopePath: "main",
          label: "rf-link",
        },
        "fs",
      ),
    ).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"delete_connection_by_label","label":"rf-link"});',
    );
  });

  it("encodes delete_connection port cleanup as the op's option", () => {
    const line = encodeCall(
      {
        op: "delete_connection",
        scopePath: "main",
        label: "rf-link",
        removePorts: true,
      },
      "fs",
    );
    const opJson = line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1);
    expect(JSON.parse(opJson)).toEqual({
      kind: "delete_connection_by_label",
      label: "rf-link",
      removePorts: true,
    });
  });

  it("encodes rename/delete/reparent actions as their dispatcher ops", () => {
    expect(
      encodeCall(
        { op: "rename_component", path: "main/drone", newLabel: "quad" },
        "fs",
      ),
    ).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"rename_component","path":"main/drone","newLabel":"quad"});',
    );
    expect(
      encodeCall({ op: "delete_component", path: "main/drone" }, "fs"),
    ).toContain('{"kind":"delete_component","path":"main/drone"}');
    expect(
      encodeCall(
        {
          op: "reparent_component",
          sourcePath: "main/drone",
          targetParentPath: "main/payload",
        },
        "fs",
      ),
    ).toContain(
      '{"kind":"reparent_component","sourcePath":"main/drone","targetParentPath":"main/payload"}',
    );
  });

  it("encodes add_connection with its resolved scope", () => {
    expect(
      encodeCall(
        {
          op: "add_connection",
          scopePath: "main",
          label: "rf-link",
          from: "fc",
          to: "radio",
        },
        "fs",
      ),
    ).toContain(
      '{"kind":"add_connection","scopePath":"main","label":"rf-link","from":"fc","to":"radio"}',
    );
  });

  it("encodes connect_components as the op that produced it", () => {
    const line = encodeCall(
      {
        op: "connect_components",
        scopePath: "main",
        label: "fc-to-radio",
        from: {
          component: "fc",
          port: {
            new: { label: "link-radio", protocol: "spi", external: true },
          },
        },
        to: { component: "radio", port: { existing: "link-fc" } },
        createProtocol: "spi",
      },
      "fs",
    );
    const opJson = line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1);
    expect(JSON.parse(opJson)).toEqual({
      kind: "connect_components",
      scopePath: "main",
      label: "fc-to-radio",
      from: {
        component: "fc",
        port: { new: { label: "link-radio", protocol: "spi", external: true } },
      },
      to: { component: "radio", port: { existing: "link-fc" } },
      createProtocol: "spi",
    });
  });

  it("omits createProtocol from connect_components when there is none", () => {
    const line = encodeCall(
      {
        op: "connect_components",
        scopePath: "main",
        label: "l",
        from: { component: "a", port: { new: { label: "p" } } },
        to: { component: "b", port: { new: { label: "q" } } },
      },
      "fs",
    );
    expect(line).not.toContain("createProtocol");
  });

  it("round-trips quotes and backslashes through op JSON", () => {
    const action: ModelAction = {
      op: "add_component_definition",
      label: 'say "hi" \\ now',
      leaf: true,
      full_name: "",
      tags: [],
      ports: [],
    };
    const line = encodeCall(action, "fs");
    const opJson = line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1);
    expect(JSON.parse(opJson)).toEqual({
      kind: "add_component_definition",
      label: 'say "hi" \\ now',
      options: { leaf: true, full_name: "", tags: [], ports: [] },
    });
  });

  it("renders a full replayable test script", () => {
    const actions: ModelAction[] = [
      { op: "add_system", label: "main", full_name: "" },
      {
        op: "add_component_definition",
        label: "drone",
        leaf: false,
        full_name: "",
        tags: [],
        ports: [],
      },
      {
        op: "add_instance",
        parentPath: "main",
        label: "drone",
        source: "drone",
      },
    ];
    const script = asTestScript(actions, "<final>");
    expect(script).toContain(
      'import { beforeAll, describe, expect, it } from "vitest";',
    );
    expect(script).toContain('import init from "rhizz";');
    expect(script).toContain(
      'import { applyModelMutation } from "./history/applyMutation";',
    );
    expect(script).toContain("beforeAll(async () => {");
    expect(script).toContain('[["system.hcl", ``]]');
    expect(script).toContain(
      '{"kind":"add_system","label":"main","full_name":""}',
    );
    expect(script).toContain(
      '{"kind":"add_instance","parentPath":"main","label":"drone","source":"drone"}',
    );
    expect(script).toContain(
      'expect(files.get("system.hcl")).toBe(`<final>`);',
    );
  });

  it("renders multi-line HCL as a readable template literal", () => {
    const baseline = `system "demo" {
  instance "a" {
    source = "a"
  }
}`;
    const hcl = `system "demo" {
  instance "b" {
    source = "b"
  }
}`;
    const script = asTestScript([], hcl, { baselineHcl: baseline });

    // Newlines are preserved as literal newlines inside backticks, not escaped
    // into \n — so the emitted source stays as readable as the HCL itself.
    expect(script).toContain('[["system.hcl", `system "demo" {');
    expect(script).toContain(
      'expect(files.get("system.hcl")).toBe(`system "demo" {\n  instance "b" {',
    );
  });

  it("escapes backticks and ${ inside multi-line HCL", () => {
    const hcl = "label = `x` and ${y}";
    const script = asTestScript([], hcl);
    // Backticks and ${ are escaped inside the template literal.
    expect(script).toContain(`toBe(\`label = \\\`x\\\` and \\\${y}\`)`);
  });

  it("seeds the pre-session baseline and applies actions exactly once", () => {
    const preSessionBaseline = `project {
}
`;
    const actions: ModelAction[] = [
      { op: "add_system", label: "drone", full_name: "" },
      {
        op: "add_component_definition",
        label: "engine",
        leaf: true,
        full_name: "",
        tags: [],
        ports: [],
      },
    ];
    const script = asTestScript(actions, "<final>", {
      baselineHcl: preSessionBaseline,
    });
    // The baseline seeded into the replay is the pre-session content.
    expect(script).toContain('[["system.hcl", `project {\n}\n`]]');
    // And each action is applied exactly once.
    expect(
      script.split('{"kind":"add_system","label":"drone","full_name":""}')
        .length - 1,
    ).toBe(1);
    expect(
      script.split('"kind":"add_component_definition","label":"engine"')
        .length - 1,
    ).toBe(1);
  });
  it("encodes an update_connection call with a realized_by patch", () => {
    const action: ModelAction = {
      op: "update_connection",
      scopePath: "banking/bank-a",
      label: "tls",
      patch: {
        full_name: "Transport",
        realized_by: [{ scopePath: "banking", label: "http" }],
      },
    };
    expect(encodeCall(action, "fs")).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"update_connection","scopePath":"banking/bank-a","label":"tls","patch":{"full_name":"Transport","realized_by":[{"scopePath":"banking","label":"http"}]}});',
    );
  });

  it("encodes add_protocol, update_protocol and delete_protocol as dispatcher ops", () => {
    expect(
      encodeCall(
        {
          op: "add_protocol",
          label: "spi",
          options: { full_name: "Serial", leaf: true },
        },
        "fs",
      ),
    ).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"add_protocol","label":"spi","options":{"full_name":"Serial","leaf":true}});',
    );
    expect(
      encodeCall(
        {
          op: "update_protocol",
          path: "spi",
          patch: { encapsulates: [] },
        },
        "fs",
      ),
    ).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"update_protocol","path":"spi","patch":{"encapsulates":[]}});',
    );
    expect(encodeCall({ op: "delete_protocol", path: "spi" }, "fs")).toBe(
      'await applyModelMutation(fs, "system.hcl", await fs.readFile("system.hcl"), {"kind":"delete_protocol","path":"spi"});',
    );
  });
});
