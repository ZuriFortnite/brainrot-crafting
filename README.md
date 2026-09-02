# Brainrot Crafting

A crafting and idle tycoon game built for **YouTube Playables**.

**▶ Play: https://zurifortnite.github.io/brainrot-crafting/**

---

## The loop

Combine ingredients on a **3×3 table** to craft collectible characters. Each one
walks onto your **plot**, where it earns coins on its own and pays a lump sum
when you tap it. **Drag two together** to merge them — identical ones level up,
different ones fuse into a mutant. **Rebirth** trades your plot and purse for a
permanent income multiplier, an extra crafting table, and the next tier of
ingredients.

- **53 characters** to discover, the last of them behind the final rebirth
- **Shapeless recipes** — what's on the table matters, not where it sits
- **Recipes are semantic**, so they can be reasoned about rather than brute
  forced: banana + monkey makes the banana monkey
- **Crafting takes real time**, from one second at the bottom to about two hours
  at the top
- **Timed world events** every hour recolour the world and permanently mutate
  whatever you craft while one is running
- **~8 hours** of progression, calibrated against a simulated player rather than
  a spreadsheet

## Built for the platform

| | |
|---|---|
| Initial load | **289 KB** over 23 requests, first frame at 0.8 s |
| Total bundle | 6.0 MB across 143 files |
| Network | One request — the Playables SDK. Everything else is local. |
| Aspect ratios | 9:32 through 32:9 |
| Saves | Playables SDK when hosted on YouTube, `localStorage` otherwise |
| Audio | Follows YouTube's audio setting; no in-game mute control |
| Lifecycle | `onPause` / `onResume`, never the Page Visibility API |

Music is **generated at runtime** rather than shipped — a licence-clean loop
would be larger than this entire bundle and would repeat audibly within a
minute.

## Layout

```
index.html          the game
src/plot.js         all of it — state, render, audio, SDK
assets/craft.json   every balance number, generated (see below)
assets/ing/         52 ingredient icons
assets/set0..3/     53 characters
assets/sfx/         12 clips, Kenney (CC0)
assets/icon/        UI icons
check.js            asset-integrity guard, run before pushing
```

## Running it

```bash
node serve.js 5173
```

Then open `http://localhost:5173`. The SDK is a documented no-op when served
locally, so saves fall back to `localStorage` and rewarded ads grant instantly —
the whole game stays playable and testable offline.

`?reset=1` wipes the save. It is **gated to localhost** so it cannot be
stumbled into on the public build.

### Testing against YouTube's CSP

`serve.js` sends the exact `Content-Security-Policy` YouTube applies to
Playables, taken verbatim from the [SDK Test Suite guide][csp]. Loading the game
locally therefore runs it under the real policy, and a violation shows in the
console instead of surfacing at certification.

Worth knowing what the sandbox directive leaves out: `allow-modals`,
`allow-popups` and `allow-downloads` are all absent, so `alert()`, `confirm()`,
`window.open()` and `<a download>` do nothing inside a Playable. This game uses
none of them.

Current status: **no violations.**

[csp]: https://developers.google.com/youtube/gaming/playables/reference/test_suite_guide

## Balance

`assets/craft.json` is generated, never hand-edited. Recipes, prices, unlock
bands and rebirth thresholds all derive from one source, and the rebirth
thresholds specifically are calibrated against a **simulated naive player** —
short sessions, heavy tapping, buying what's affordable rather than what's
optimal, closing the tab for hours.

That simulation mattered: the first analytic model was out by more than tenfold,
because it assumed income comes from idling when for a real thumb on a real phone
it comes from tapping.

## Credits

Sound effects by [Kenney](https://kenney.nl) — Interface Sounds, Casino Audio and
RPG Audio, all CC0. Character and ingredient art generated for this project.
