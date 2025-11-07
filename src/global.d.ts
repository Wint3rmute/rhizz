export {};

declare global {
  interface Window {
    electronAPI: {
      setTitle: (title: string) => void;
      onModelFilesUpdate: (callback: (value: string) => void) => void;
    };
  }

  // Make electronAPI available on globalThis as well
  var electronAPI: Window["electronAPI"];
}
