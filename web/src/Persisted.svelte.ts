export default function persisted<T>(key: string, initial: T) {
  const stored = localStorage.getItem(key);
  let parsed = initial;

  if (stored !== null) {
    try {
      parsed = JSON.parse(stored) as T;
    } catch {
      parsed = initial;
      localStorage.setItem(key, JSON.stringify(initial));
    }
  }

  let value = $state<T>(parsed);
  $effect(() => {
    localStorage.setItem(key, JSON.stringify(value));
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
