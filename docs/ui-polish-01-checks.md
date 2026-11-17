# UI-POLISH-01, part 1: keyboard, hit areas, widths and offline

Stage 8 of the redesign sequence in `ui-arch-00-redesign-audit.md`. This part covers the checks that do not change the visual design. The rest of the stage is not done here:

- the visual comparison with the approved mockups, which are not in the repository;
- colour and palette work, which overlaps the separate «упрощення Протокола» work (its step 6 is the palette).

## What is checked

`uiPolish.spec.ts` runs the four tabs (Сьогодні, Мій план, Результати, Більше) on a filled synthetic profile, in both builds.

- **Widths.** At all seven approved widths (320, 375, 390, 430, 768, 1024 and 1440 px), each tab opens with its heading and has no horizontal overflow.
- **Hit areas.** Every control is at least 44 × 44 px: buttons, links, fields, switches and disclosure summaries in the main area, the header and the navigation. Links inside running text are not counted, because they are measured by their line.
- **Keyboard focus.** At phone (390 px) and desktop (1440 px) widths, Tab goes through each tab. Every focused control must be on screen and show a focus indicator.
- **Offline.** After the four tabs are opened once, a reload with no network still opens each of them from the bottom navigation.

## What was found and fixed

- **The weight form's date field lost its focus ring** on «Результати». In Chrome, Tab inside a date field also reaches the browser's calendar button. While that button has focus, the field itself does not match `:focus-visible`, so a keyboard user could not see where focus was. Date, time and date-time fields now keep the same accent ring while anything inside them has focus. No colour or token changed.

All other controls on the four tabs already met the 44 px and focus requirements at every width.

## Verification

- Before the fix, `uiPolish.spec.ts` reports the date field at 390 and 1440 px. After the fix it passes in the acceptance and compatibility builds.
