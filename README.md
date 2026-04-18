# obsidian-docindex

Obsidian plugin (desktop + mobile) that queries a remote [docindex-server](https://github.com/marcioapm/docindex-server) for semantic + BM25 search over your vault. Thin client — the index lives on a Tailscale-reachable backend; the plugin just queries and opens notes.

## Origin
Fork of [joybro/obsidian-similar-notes](https://github.com/joybro/obsidian-similar-notes) (MIT), modified to:
- Add a `remote` search provider that calls `docindex-server` over Tailscale
- Keep the existing results UI and similar-notes modal
- Set `isDesktopOnly: false` so it works on iOS/Android

## Config
- **Backend URL** (e.g. `http://100.x.y.z:7777`)
- **Bearer token**
- **Result limit** (default 10)

## Requirements
- `docindex-server` reachable over Tailscale from your phone.
- Tailscale app on the phone, logged in to the same tailnet.

## Status
Not yet forked. Deferred until backend is stable.

## License
Private — for personal use. Upstream is MIT.
