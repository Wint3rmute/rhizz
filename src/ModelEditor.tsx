import * as React from "react";
// eslint-disable-next-line import/no-named-as-default
import Editor from "@monaco-editor/react";

export function ModelEditor(
  { default_value, on_editor_change }: {
    default_value: string;
    on_editor_change: (value: string) => void;
  },
) {
  const handleEditorChange = (value: string | undefined) => {
    if (value) {
      on_editor_change(value);
    }
  };

  return (
    <Editor
      height="90vh"
      width="80%"
      defaultLanguage="yaml"
      defaultValue={default_value}
      onChange={handleEditorChange}
    />
  );
}
