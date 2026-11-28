// Where a diagnostic points: the file and line the compiler reports (the
// line of the block it is about, see "Location" in SPEC/diagnostics.md), and
// the Code page query that opens it. View diagnostics name a file but no
// line; project-wide ones name neither.

/** The location fields of a diagnostic (`DiagnosticJS` or a plain fixture). */
export interface Locatable {
  file?: string | null | undefined;
  line?: number | null | undefined;
}

export interface DiagnosticLocation {
  file: string;
  line: number | null;
  /** `system.hcl:14`, or just the path when there is no line. */
  label: string;
}

export function diagnosticLocation(
  diagnostic: Locatable,
): DiagnosticLocation | null {
  const file = diagnostic.file ?? "";
  if (file === "") return null;
  const line = diagnostic.line ?? null;
  return {
    file,
    line,
    label: line === null ? file : `${file}:${String(line)}`,
  };
}

/** The Code page query (`?file=…&line=…`) that opens `location`. */
export function codeLocationQuery(
  location: Pick<DiagnosticLocation, "file" | "line">,
): string {
  const params = new URLSearchParams({ file: location.file });
  if (location.line !== null) params.set("line", String(location.line));
  return `?${params.toString()}`;
}

/** The `?line=` value as a 1-based line number, or null when absent/invalid. */
export function parseLineParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const line = Number(value);
  return line >= 1 ? line : null;
}
