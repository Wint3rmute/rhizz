// The palette's action rows: global commands that are not navigation and
// not files. Offered on every palette scope (modeling / explore / code /
// inventory) — like the page commands, unlike the files.
//
// Only two rows: opening the settings modal (owned by the navbar, reached
// via ./settingsRequest) and toggling the theme (via ThemeState). Rows are
// built here and *acted* by the host — `actionItems` takes the callbacks,
// because requesting settings and toggling the theme are the two things
// that need a live component graph.
import type { PaletteItem } from "../components/palette/commandPalette";
import { resolveIcon } from "../iconHelper";

export const ACTIONS_GROUP = "Actions";

export function actionItems({
  onOpenSettings,
  onToggleTheme,
}: {
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}): PaletteItem[] {
  return [
    {
      id: "command:open-settings",
      label: "Open settings",
      icon: resolveIcon("gear"),
      group: ACTIONS_GROUP,
      // The bare word is on screen already, so the hint carries what it is
      // not: the synonyms a user guesses ("preferences").
      hint: "settings preferences",
      action: () => {
        onOpenSettings();
      },
    },
    {
      id: "command:toggle-theme",
      label: "Toggle theme",
      icon: resolveIcon("circle-half-stroke"),
      group: ACTIONS_GROUP,
      // "theme" is on screen; the modes and synonyms are not.
      hint: "dark light mode appearance theme",
      action: () => {
        onToggleTheme();
      },
    },
  ];
}
