import { describe, expect, it } from "vitest";
import { MergedHistory } from "./MergedHistory";
import type { Transaction } from "./TransactionManager";

/**
 * A layout whose state is a single number, so every assertion reads as
 * "the canvas is now N".
 */
function layoutAt(initial: number) {
  let value = initial;
  const history = new MergedHistory<number>({
    layout: {
      snapshot: () => value,
      apply: (n) => {
        value = n;
      },
    },
  });
  return {
    history,
    get value() {
      return value;
    },
    set(n: number) {
      value = n;
    },
  };
}

/** A transaction that flips `states[0]` between "on" and "off". */
function flipping(label: string, states: string[]): Transaction {
  return {
    label,
    do: () => {
      states[0] = "on";
      return true;
    },
    undo: () => {
      states[0] = "off";
    },
  };
}

function refusing(label: string): Transaction {
  return { label, do: () => false, undo: () => {} };
}

describe("MergedHistory — layout only", () => {
  it("undoes a recorded layout point", async () => {
    const l = layoutAt(0);
    l.history.recordLayoutPoint();
    l.set(1);
    expect(await l.history.undo()).toBe(true);
    expect(l.value).toBe(0);
  });

  it("redoes what undo reverted", async () => {
    const l = layoutAt(0);
    l.history.recordLayoutPoint();
    l.set(1);
    await l.history.undo();
    expect(await l.history.redo()).toBe(true);
    expect(l.value).toBe(1);
  });

  it("returns false when there is nothing to undo", async () => {
    const l = layoutAt(0);
    expect(await l.history.undo()).toBe(false);
    expect(await l.history.redo()).toBe(false);
  });

  it("drops the layout redo when a new point is recorded", async () => {
    const l = layoutAt(0);
    l.history.recordLayoutPoint();
    l.set(1);
    await l.history.undo();
    expect(await l.history.redo()).toBe(true);
    l.history.recordLayoutPoint();
    expect(await l.history.redo()).toBe(false);
  });

  it("walks a multi-step sequence back and forward", async () => {
    const l = layoutAt(0);
    for (const n of [1, 2, 3]) {
      l.history.recordLayoutPoint();
      l.set(n);
    }
    await l.history.undo();
    expect(l.value).toBe(2);
    await l.history.undo();
    expect(l.value).toBe(1);
    await l.history.undo();
    expect(l.value).toBe(0);
    await l.history.redo();
    expect(l.value).toBe(1);
    await l.history.redo();
    expect(l.value).toBe(2);
  });

  it("caps retained entries at the limit", async () => {
    let value = 0;
    const history = new MergedHistory<number>({
      limit: 3,
      layout: { snapshot: () => value, apply: (n) => (value = n) },
    });
    for (const n of [1, 2, 3, 4, 5]) {
      history.recordLayoutPoint();
      value = n;
    }
    // Only 3 retained, so undoing 4 times exhausts them and the 5th is a no-op.
    for (const expected of [4, 3, 2]) {
      expect(await history.undo()).toBe(true);
      expect(value).toBe(expected);
    }
    expect(await history.undo()).toBe(false);
  });
});

describe("MergedHistory — model only", () => {
  it("undoes a transaction that ran", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    expect(await l.history.runModelTransaction(flipping("t", state))).toBe(
      true,
    );
    expect(state[0]).toBe("on");
    expect(await l.history.undo()).toBe(true);
    expect(state[0]).toBe("off");
  });

  it("does not record a transaction that refused", async () => {
    const l = layoutAt(0);
    expect(await l.history.runModelTransaction(refusing("t"))).toBe(false);
    expect(await l.history.undo()).toBe(false);
  });

  it("redoes a transaction by re-running it", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    await l.history.runModelTransaction(flipping("t", state));
    await l.history.undo();
    expect(state[0]).toBe("off");
    expect(await l.history.redo()).toBe(true);
    expect(state[0]).toBe("on");
  });
});

describe("MergedHistory — interleaving", () => {
  it("undoes a layout edit made after a model edit", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    await l.history.runModelTransaction(flipping("create", state));
    l.history.recordLayoutPoint();
    l.set(5);

    expect(await l.history.undo()).toBe(true);
    expect(l.value).toBe(0);
    expect(state[0]).toBe("on");

    expect(await l.history.undo()).toBe(true);
    expect(state[0]).toBe("off");
  });

  it("undoes a model edit made after a layout edit", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    l.history.recordLayoutPoint();
    l.set(5);
    await l.history.runModelTransaction(flipping("create", state));

    expect(await l.history.undo()).toBe(true);
    expect(state[0]).toBe("off");
    expect(l.value).toBe(5);

    expect(await l.history.undo()).toBe(true);
    expect(l.value).toBe(0);
  });

  it("redoes in the order the edits originally happened", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    // create the model entry, then move the layout.
    await l.history.runModelTransaction(flipping("create", state));
    l.history.recordLayoutPoint();
    l.set(5);

    await l.history.undo();
    await l.history.undo();

    // Redo replays forwards, so the create comes back before the drag.
    expect(await l.history.redo()).toBe(true);
    expect(state[0]).toBe("on");
    expect(l.value).toBe(0);
    expect(await l.history.redo()).toBe(true);
    expect(l.value).toBe(5);
  });

  it("keeps the two domains' redo stacks independent", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    await l.history.runModelTransaction(flipping("create", state));
    l.history.recordLayoutPoint();
    l.set(5);
    await l.history.undo();
    await l.history.undo();

    // A new layout edit must not discard the model redo.
    l.history.recordLayoutPoint();
    l.set(9);
    await l.history.undo();
    expect(l.value).toBe(0);

    // The model redo is still pending, and it was undone first, so it is
    // replayed first; the layout entry follows.
    expect(await l.history.redo()).toBe(true);
    expect(state[0]).toBe("on");
    expect(await l.history.redo()).toBe(true);
    expect(l.value).toBe(9);
  });

  it("falls through to the other domain when the newer one is exhausted", async () => {
    const state = ["off"];
    const l = layoutAt(0);
    l.history.recordLayoutPoint();
    l.set(5);
    await l.history.runModelTransaction(flipping("create", state));

    // Model is newest, so it goes first; the layout point follows even
    // though there is no model undo left to compare against.
    expect(await l.history.undo()).toBe(true);
    expect(state[0]).toBe("off");
    expect(await l.history.undo()).toBe(true);
    expect(l.value).toBe(0);
  });
});
