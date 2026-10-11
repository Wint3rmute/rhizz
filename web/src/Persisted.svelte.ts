import { safeGetItem, safeSetItem } from "./safeStorage";

export default function persisted<T>(key: string, initial: T) {
  const stored = safeGetItem(key);
  let parsed = initial;

  if (stored !== null) {
    try {
      parsed = JSON.parse(stored) as T;
    } catch {
      parsed = initial;
      safeSetItem(key, JSON.stringify(initial));
    }
  }

  let value = $state<T>(parsed);
  $effect(() => {
    safeSetItem(key, JSON.stringify(value));
  });
  return {
    get value() {
      return value;
    },
    set value(v) {
      value = v;
    },
  };
}
