# Website development

- Reply in Chinese. Do not publish, push, or run the deployment workflow unless the user explicitly requests it.
- Current source is `public/horizon.html`, `public/horizon.css`, `public/horizon.js`, and `public/blackhole.js`; `docs/` is a historical design snapshot.
- Keep public project descriptions in `content/projects.json` accurate. Preserve the deployed site's current data and icon snapshot when the repository's scheduled-sync input is older; do not invent descriptions or perform unrelated release updates.
- Keep featured names, descriptions, icons and previews tied to the catalog templates. When a product is renamed, preserve its repository ID and old search aliases. Verify public download versions separately from unpublished source versions. Record visual provenance in `content/project-sources.json` and label diagrams, character assets and offscreen captures accurately.
- Use the existing dependency-free Node scripts (Node 22+). Build with `node scripts/build.mjs`; production output uses `node scripts/build.mjs --production`.
- Preview with `node scripts/serve.mjs`; `PORT` selects the loopback port. Only `dist/` and `dist-production/` are disposable generated build directories.
- Check changed JS using `node --check`, rendering with `node design/check-render-scheduler.mjs` and `node design/analyze-ray-cost.mjs`, bloom sampling with `node scripts/check-bloom-kernel.mjs`, and icon code using `python -m unittest discover -s scripts -p "test_*.py"` when relevant.
- Preserve the full ray integration and material data when reducing rendering cost. Test the actual shader on a real GPU and visually compare fixed camera/time captures when changing quality.
- Keep the page context menu with Refresh; preserve native browser context menus on links, media, editable fields, selected text, and Shift + right-click. Quality selection must work with keyboard and touch, and preserve explicit user choices.
- Report simulated scheduling checks separately from GPU measurements. GPU timings are device-specific and do not measure whole-computer power or total browser memory.
- For README package synchronization changes, run `node scripts/test-readme-packages.mjs`; verify actual published README links as well as historical-name and preview exclusions.
