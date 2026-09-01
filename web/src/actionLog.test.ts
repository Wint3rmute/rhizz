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
    log.record({ op: "add_system", label: "main", description: "" });
    log.record({ op: "add_system", label: "backup", description: "" });
    expect(log.actions().map((a) => a.op)).toEqual([
      "add_system",
      "add_system",
    ]);
    log.clear();
    expect(log.actions()).toEqual([]);
  });

  it("encodes a new_project call", () => {
    expect(
      encodeCall(
        { op: "new_project", name: "drone", version: "1.0.0", authors: ["A"] },
        "project",
      ),
    ).toBe('project.setProject("drone", "1.0.0", ["A"]);');
  });

  it("encodes an add_system call", () => {
    expect(
      encodeCall(
        { op: "add_system", label: "main", description: "A system" },
        "p",
      ),
    ).toBe('p.addSystem("main", "A system");');
  });

  it("encodes an add_component call with ports", () => {
    const action: ModelAction = {
      op: "add_component",
      parentPath: "main",
      label: "drone",
      leaf: false,
      description: "",
      tags: ["power"],
      icon: "rocket",
      color: "primary",
      border: "dashed",
      font: "bold",
      ports: [{ label: "rf", role: "peer" }],
    };
    expect(encodeCall(action, "project")).toBe(
      'project.addComponent("main", "drone", { tags: ["power"], icon: "rocket", color: "primary", border: "dashed", font: "bold", ports: [{ label: "rf", role: "peer" }] });',
    );
  });

  it("omits the options object when a component has no extra fields", () => {
    const action: ModelAction = {
      op: "add_component",
      parentPath: "main",
      label: "drone",
      leaf: false,
      description: "",
      tags: [],
      ports: [],
    };
    expect(encodeCall(action, "project")).toBe(
      'project.addComponent("main", "drone");',
    );
  });

  it("encodes an update_component call with a patch", () => {
    const action: ModelAction = {
      op: "update_component",
      path: "main/drone",
      patch: {
        description: "A quadcopter",
        tags: ["power", "flight"],
        leaf: true,
      },
    };
    expect(encodeCall(action, "project")).toBe(
      'project.updateComponent("main/drone", { description: "A quadcopter", tags: ["power", "flight"], leaf: true });',
    );
  });

  it("encodes an add_connection call", () => {
    const action: ModelAction = {
      op: "add_connection",
      scopePath: "main",
      label: "rf-link",
      from: "drone",
      to: "antenna",
    };
    expect(encodeCall(action, "project")).toBe(
      'project.addConnection("main", { label: "rf-link", from: "drone", to: "antenna" });',
    );
  });

  it("encodes add_port, add_protocol and update_node_layout calls", () => {
    expect(
      encodeCall(
        {
          op: "add_port",
          compPath: "main/drone",
          port: {
            label: "rf",
            role: "provider",
            protocol: "data",
            external: true,
          },
        },
        "project",
      ),
    ).toBe(
      'project.addPort("main/drone", "rf", "data", "provider", true, true);',
    );
    expect(
      encodeCall(
        { op: "add_protocol", label: "data", description: "A data protocol" },
        "project",
      ),
    ).toBe('project.addProtocol("data", "A data protocol");');
    expect(
      encodeCall(
        {
          op: "update_node_layout",
          viewLabel: "main",
          componentKey: "main/drone",
          layout: { x: 100, y: 200, width: 120, text_align: "top-left" },
        },
        "project",
      ),
    ).toBe(
      'project.updateNodeLayout("main", "main/drone", { x: 100, y: 200, width: 120, text_align: "top-left" });',
    );
  });

  it("escapes quotes and backslashes in labels", () => {
    const action: ModelAction = {
      op: "add_component",
      parentPath: "main",
      label: 'say "hi" \\ now',
      leaf: true,
      description: "",
      tags: [],
      ports: [],
    };
    expect(encodeCall(action, "project")).toContain(
      'project.addComponent("main", "say \\"hi\\" \\\\ now", { leaf: true });',
    );
  });

  it("renders a full replayable test script", () => {
    const actions: ModelAction[] = [
      { op: "new_project", name: "drone", version: "0.1.0", authors: [] },
      { op: "add_system", label: "main", description: "" },
      {
        op: "add_component",
        parentPath: "main",
        label: "drone",
        leaf: false,
        description: "",
        tags: [],
        ports: [],
      },
      {
        op: "add_component",
        parentPath: "main",
        label: "antenna",
        leaf: false,
        description: "",
        tags: [],
        ports: [],
      },
      {
        op: "add_connection",
        scopePath: "main",
        label: "rf-link",
        from: "drone",
        to: "antenna",
      },
    ];
    const script = asTestScript(actions, "project { ... }");
    expect(script).toContain(
      'import { describe, expect, it } from "vitest";',
    );
    expect(script).toContain(
      'import { DocumentStore } from "./DocumentStore.svelte";',
    );
    expect(script).toContain("const project = new DocumentStore();");
    expect(script).toContain('project.addSystem("main", "");');
    expect(script).toContain(
      'project.addConnection("main", { label: "rf-link", from: "drone", to: "antenna" });',
    );
    expect(script).toContain(
      "expect(project.systemHcl).toBe(`project { ... }`);",
    );
  });

  it("renders multi-line HCL as a readable template literal", () => {
    const baseline = `system "demo" {
  component "a" {
    leaf = true
  }
}`;
    const hcl = `system "demo" {
  component "b" {
    leaf = true
  }
}`;
    const script = asTestScript([], hcl, { baselineHcl: baseline });

    // Newlines are preserved as literal newlines inside backticks, not escaped
    // into \n — so the emitted source stays as readable as the HCL itself.
    expect(script).toContain(
      '    project.loadFromHcl(`system "demo" {\n  component "a" {',
    );
    expect(script).toContain(
      '    expect(project.systemHcl).toBe(`system "demo" {\n  component "b" {',
    );
  });

  it("escapes backticks and ${ inside multi-line HCL", () => {
    const hcl = "label = `x` and ${y}";
    const script = asTestScript([], hcl);
    // Backticks and ${ are escaped inside the template literal.
    expect(script).toContain(`toBe(\`label = \\\`x\\\` and \\\${y}\`)`);
  });

  it("encodes a sourced add_component as addComponentSource", () => {
    const action: ModelAction = {
      op: "add_component",
      parentPath: "testing-harness",
      label: "engine",
      leaf: false,
      description: "",
      tags: [],
      ports: [],
      source: "engine",
    };
    expect(encodeCall(action, "project")).toBe(
      'project.addComponentSource("testing-harness", "engine", "engine");',
    );
  });

  it("emits the expected baseline (pre-session state), not the post-session state", () => {
    // The user's trace: baseline already contains drone/engine + a drone system.
    // The replay must seed from the *pre-session* baseline (an empty project),
    // then apply the mutations once — never double-apply them.
    const preSessionBaseline = `project {
}
`;
    const actions: ModelAction[] = [
      { op: "add_system", label: "drone", description: "" },
      {
        op: "add_component",
        parentPath: "drone",
        label: "engine",
        leaf: true,
        description: "",
        tags: [],
        ports: [],
      },
    ];
    const script = asTestScript(actions, "<final>", {
      baselineHcl: preSessionBaseline,
    });
    // The baseline seeded into the replay is the pre-session content.
    expect(script).toContain("    project.loadFromHcl(`project {\n}");
    // And the actions are applied exactly once.
    expect(script).toContain('project.addSystem("drone", "");');
    expect(script).toContain(
      'project.addComponent("drone", "engine", { leaf: true });',
    );
  });
});
