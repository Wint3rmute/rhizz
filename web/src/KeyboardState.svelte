<script module lang="ts">
  // Tracks which keyboard keys are currently held down, using
  // KeyboardEvent.code (the physical key, independent of layout/shift
  // state) so callers can reliably ask "is Space held" or "is Control
  // held" regardless of what's focused. Listens at the window level so it
  // works no matter which element has focus \u2014 or none at all.
  //
  // Generic on purpose: any feature that needs "is key X currently held"
  // (e.g. hold-Space-to-pan) can reuse this instead of adding its own
  // keydown/keyup listeners.
  const heldKeys = $state<Record<string, true>>({});

  function setHeld(code: string, isHeld: boolean) {
    if (isHeld) {
      heldKeys[code] = true;
    } else {
      delete heldKeys[code];
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => setHeld(e.code, true));
    window.addEventListener("keyup", (e) => setHeld(e.code, false));
    // Held-key state can get stuck "on" if a key is released while the
    // window doesn't have focus (e.g. switching apps mid-shortcut, or a
    // browser/OS shortcut intercepting the keyup) \u2014 clear everything
    // when focus is lost so nothing stays permanently held.
    window.addEventListener("blur", () => {
      for (const code of Object.keys(heldKeys)) delete heldKeys[code];
    });
  }

  /** Whether the given physical key (KeyboardEvent.code) is currently held. */
  export function isKeyHeld(code: string): boolean {
    return !!heldKeys[code];
  }

  /**
   * Whether the platform's "primary" modifier key is held. Checking both
   * Ctrl and Cmd (rather than sniffing the OS to pick one) is the
   * idiomatic web convention for cross-platform shortcuts: Ctrl and Cmd
   * are never held at the same time in normal use, so there's no
   * ambiguity, and it avoids relying on unreliable platform detection.
   */
  export function isModifierHeld(): boolean {
    return (
      isKeyHeld("ControlLeft") ||
      isKeyHeld("ControlRight") ||
      isKeyHeld("MetaLeft") ||
      isKeyHeld("MetaRight")
    );
  }

  /** Whether the spacebar is currently held. */
  export function isSpaceHeld(): boolean {
    return isKeyHeld("Space");
  }
</script>
