Brand assets
============

Place your public brand assets in this folder. Anything in here is served by Vite/Nginx at the URL path `/brand/...`.

Current UI references
- Login logo: `/brand/ECHO_logo.png`
- Favicon: `/brand/ECHO_logo.png`

Notes
- For local dev, put your logo files here so Vite serves them without extra config.
- For production, the files in this folder are copied into the built image and served by Nginx.
- Recommended filenames: `ECHO_logo.png` (512×512 or 1024×1024) and `ECHO_logo.svg` (optional).
- You can add additional assets (e.g. backgrounds, icons) and reference them via `/brand/<name>` anywhere in the app.

