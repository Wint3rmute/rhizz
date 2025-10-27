import { useEffect, useState } from "react";

function getStorageValue(key: string, defaultValue: string): string {
  // getting stored value
  const saved = localStorage.getItem(key);
  return saved || defaultValue;
}

export const useLocalStorage = (
  key: string,
  defaultValue: string,
): [string, (value: string) => void] => {
  const [value, setValue] = useState(() => {
    return getStorageValue(key, defaultValue);
  });

  useEffect(() => {
    // storing input name
    localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue];
};
