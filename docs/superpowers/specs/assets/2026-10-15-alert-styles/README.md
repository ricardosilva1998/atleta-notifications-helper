# Alert styles proposal (version 7): the reference for every look

The proposal page the owner approved on 2026-10-15, with its source. The design is
`../../2026-10-15-alert-styles-design.md`; every look here is the reference for the code in
`public/overlay/objects/styles/`.

- `atleta-alert-styles.html`: the page itself (also published at https://claude.ai/artifact/HbyZwPiMjL3gKzBuc8Emi5).
  It needs no server to read, but its fonts come from Google Fonts.
- `parts/`: the source the page is built from.
  - `fam/<key>.js` and `fam/<key>.css`: one family each (racing, qs Quest, cm Comic, cz Cozy, cs Cosmos,
    gl Glass, spk Spooky, cyb Cyber, wst Western, ros Retro OS, gfi Graffiti, kwi Kawaii, stm Steampunk,
    fro Frost, and from proposal 5 neo Neon Sign, sea Deep Sea, mus Music, std Stadium, fwk Fireworks, dno Dino,
    ufo UFO, nws Breaking News).
  - `90-core.js` and `40-styles.css`: the shared helpers, Grand Prix, Cockpit, Arcade and the omikuji.
  - `30-samurai.css` and `80-samurai.js`: copies of today's five objects (`public/overlay/objects/`).
  - `20-page.css`, `70-body.html` and `99-ui.js`: the page around the looks, which is not part of the overlay.
- `build.sh`: rebuilds the page from `parts/` (`bash build.sh`), or checks one family (`bash build.sh qs`).
- `tools/`: what was used to check the looks. Serve this folder (`python3 -m http.server`) and open
  `solo.html` after `bash tools/solo.sh racing qs` (any family keys):
  - `film.js`: `film(id, times)` freezes a look at several moments side by side; `gallery(ids)` shows looks
    finished; `audit()` measures every look against its height budget and the 420 px slot.
  - `compare.js`: `compareReset()` lays every look out with and without the overlay's border-box reset.
