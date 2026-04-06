export default function persisted<T>(key: string, initial: T) {
  let value = $state<T>(
    JSON.parse(localStorage.getItem(key) ?? "null") ?? initial,
  );
  $effect(() => localStorage.setItem(key, JSON.stringify(value)));
  return {
    get value() {
      return value;
    },
    set value(v) {
      value = v;
    },
  };
}
