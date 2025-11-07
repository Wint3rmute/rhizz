export {};

declare global {
  interface Window {
    electronAPI: {
      setTitle: (title: string) => void;
      onModelFilesUpdate: (callback: (value: string) => void) => void;
    };
  }

  // eslint-disable-next-line no-var
  var electronAPI: Window["electronAPI"];
}
