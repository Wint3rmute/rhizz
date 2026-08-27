import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../../../components/treeTypes";
import {
  buildComponentTree,
  type ComponentTreeComponent,
  type ComponentTreeSystem,
} from "./componentTree";

function comp(
  label: string,
  overrides: Partial<ComponentTreeComponent> = {},
): ComponentTreeComponent {
  return { label, ...overrides };
}

function sys(label: string): ComponentTreeSystem {
  return { label };
}

/** Reduces a tree to { id, isExpandable, children } for readable assertions. */
function shape(nodes: TreeNode[]): {
  id: string;
  isExpandable: boolean;
  children: ReturnType<typeof shape>;
}[] {
  return nodes.map((n) => ({
    id: n.id,
    isExpandable: n.isExpandable,
    children: shape(n.children),
  }));
}

describe("buildComponentTree", () => {
  it("returns an empty tree for an empty model", () => {
    expect(buildComponentTree([], [])).toEqual([]);
  });

  it("renders systems as roots with their top-level components as children", () => {
    const tree = buildComponentTree(
      [sys("drone")],
      [comp("fc", { parent_system_index: 0 })],
    );
    expect(shape(tree)).toEqual([
      {
        id: "sys:0",
        isExpandable: true,
        children: [
          { id: "0", isExpandable: false, children: [] },
        ],
      },
    ]);
  });

  it("is keyed by arena index, not label", () => {
    const tree = buildComponentTree(
      [],
      [comp("a"), comp("b"), comp("a")],
    );
    expect(tree.map((n) => n.id)).toEqual(["0", "1", "2"]);
  });

  it("nests components under their parent component across multiple levels", () => {
    const tree = buildComponentTree(
      [sys("drone")],
      [
        comp("fc", { parent_system_index: 0 }),
        comp("mcu", { parent_component_index: 0 }),
        comp("imu", { parent_component_index: 1 }),
      ],
    );
    expect(shape(tree)).toEqual([
      {
        id: "sys:0",
        isExpandable: true,
        children: [
          {
            id: "0",
            isExpandable: true,
            children: [
              {
                id: "1",
                isExpandable: true,
                children: [{ id: "2", isExpandable: false, children: [] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("nests a child under its parent regardless of input order", () => {
    // The invariant is structural (a parent exists before its children are
    // attached), not that sibling order is normalized — that reflects the
    // model's own arena-index (source) order. Sibling ordering is therefore
    // allowed to differ between two genuinely different input arrays.
    const childFirst = buildComponentTree(
      [sys("drone")],
      [
        comp("mcu", { parent_component_index: 1 }),
        comp("fc", { parent_system_index: 0 }),
      ],
    );
    // mcu (index 0) references fc (index 1) as its parent, even though it
    // appears first in the array. It must still nest under fc.
    const fc = childFirst[0]!.children[0]!;
    expect(fc.id).toBe("1");
    expect(fc.isExpandable).toBe(true);
    expect(fc.children.map((c) => c.name)).toEqual(["mcu"]);
  });

  it("treats a component whose parent isn't present as an orphan root", () => {
    const tree = buildComponentTree([sys("drone")], [
      comp("mcu", { parent_component_index: 99 }),
    ]);
    expect(tree.length).toBe(2);
    expect(tree[0].id).toBe("sys:0"); // system root
    expect(tree[0].isExpandable).toBe(false);
    // The orphan hangs at top level, not under the (nonexistent) parent.
    expect(tree[1]).toMatchObject({ id: "0", isExpandable: false });
  });

  it("shows an expand/collapse toggle only for non-leaf nodes", () => {
    const tree = buildComponentTree(
      [sys("a"), sys("b")],
      [
        comp("leaf-a", { parent_system_index: 0 }),
        comp("composite", { parent_system_index: 1 }),
        comp("child", { parent_component_index: 1 }),
      ],
    );
    const systemA = tree[0]!;
    const systemB = tree[1]!;
    expect(systemA.children[0]).toMatchObject({ id: "0", isExpandable: false });
    expect(systemB.children[0]).toMatchObject({
      id: "1",
      isExpandable: true,
    });
  });
});
