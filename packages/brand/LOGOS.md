# Logos (in logos/)

- `tachisto-wordmark.svg`: the primary logo for light grounds (`paper`, `paper-raised`). Cross in `stimulus` #E4572E, the rest in `ink` #1C2B2D.
- `tachisto-wordmark-dark.svg`: the same on dark grounds. Cross #F06A43, the rest #F6F4EE.
- `tachisto-wordmark-animated.svg`: light wordmark whose first cross cycles stimulus → mask → blank. Use it on the loading screen only.
- `tachisto-icon.svg` / `tachisto-icon-dark.svg`: the first t alone, transparent. Use it for small headers and inline marks.
- `tachisto-app-icon.svg` / `tachisto-app-icon-dark.svg`: the t on a `radius-lg` tile. Use it for the PWA manifest, social cards and app stores.
- `favicon.svg`: switches inks with `prefers-color-scheme`.
- `tachisto-loader.svg`: the animated t alone, for spinners and preview loading.
- `tachisto-social-card.png`: the 1200×630 link-preview card the website names in its Open Graph tags. It is rendered from `scripts/social-card.ts`; run `npm run social-card --workspace tachisto-brand` after changing the wordmark, inks or fonts.

All files have fixed inks: `<img>` can't recolour them, so pick the light or dark file to match the ground.
