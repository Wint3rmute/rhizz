// Helper module for resolving and rendering FontAwesome solid SVG icons.

import * as solidIcons from "@fortawesome/free-solid-svg-icons";

export interface ResolvedIcon {
  width: number;
  height: number;
  svgPath: string;
}

function toSvgPath(rawPath: string | string[]): string {
  return Array.isArray(rawPath) ? rawPath.join(" ") : rawPath;
}

/**
 * Normalizes an icon name (e.g. "microchip", "fa-microchip", "battery-full", "faServer")
 * into the FontAwesome export name (e.g. "faMicrochip", "faBatteryFull", "faServer").
 */
export function normalizeIconName(name: string): string {
  if (!name) return "";
  let clean = name.trim();
  if (clean.startsWith("fa-")) {
    clean = clean.slice(3);
  } else if (
    clean.startsWith("fa") && clean.length > 2 &&
    clean[2] === clean[2].toUpperCase()
  ) {
    clean = clean.slice(2);
  }

  // Convert kebab-case or snake_case to PascalCase with 'fa' prefix
  const pascal = clean
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return `fa${pascal}`;
}

/**
 * Resolves an icon name into SVG geometry (width, height, path) if valid.
 */
export function resolveIcon(name?: string | null): ResolvedIcon | null {
  if (!name) return null;
  const exportKey = normalizeIconName(name);
  const iconDef = (solidIcons as Record<string, unknown>)[exportKey] as
    | { icon: [number, number, unknown[], string, string | string[]] }
    | undefined;

  if (iconDef && Array.isArray(iconDef.icon) && iconDef.icon.length >= 5) {
    const [width, height, , , svgPath] = iconDef.icon;
    return { width, height, svgPath: toSvgPath(svgPath) };
  }

  return null;
}

// Built-in file tree icon helpers
export const folderIcon: ResolvedIcon = {
  width: solidIcons.faFolder.icon[0],
  height: solidIcons.faFolder.icon[1],
  svgPath: toSvgPath(solidIcons.faFolder.icon[4]),
};

export const folderOpenIcon: ResolvedIcon = {
  width: solidIcons.faFolderOpen.icon[0],
  height: solidIcons.faFolderOpen.icon[1],
  svgPath: toSvgPath(solidIcons.faFolderOpen.icon[4]),
};

export const fileIcon: ResolvedIcon = {
  width: solidIcons.faFile.icon[0],
  height: solidIcons.faFile.icon[1],
  svgPath: toSvgPath(solidIcons.faFile.icon[4]),
};

export const fileCodeIcon: ResolvedIcon = {
  width: solidIcons.faFileCode.icon[0],
  height: solidIcons.faFileCode.icon[1],
  svgPath: toSvgPath(solidIcons.faFileCode.icon[4]),
};
