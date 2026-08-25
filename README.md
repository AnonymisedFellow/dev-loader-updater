# Dev Loader Updater

Dev Loader Updater installs and updates Obsidian plugins from self-hosted release URLs. It is primarily intended for private plugin distribution, including mobile vaults where manually copying plugin files is inconvenient.

## Source URLs

Each source accepts one or more HTTP(S) URLs. URLs are tried from top to bottom until one works:

- A Gitea repository releases page, for example `https://gitea.example/owner/repository/releases`.
- A plugin directory containing `manifest.json` and `main.js`, optionally with `styles.css`.

The plugin ID is read from `manifest.json`. The source does not require the ID to be entered manually.

For a private Gitea repository, open the source's optional authentication section and provide a Gitea access token. The token is stored in Obsidian plugin data on the device and is sent only as an authorization header to the configured source.

## Updates

The loader can check sources on startup and optionally install newer versions automatically. If the target plugin was already enabled, restart Obsidian after an update so its new JavaScript is loaded.

## Repository

https://github.com/AnonymisedFellow/dev-loader-updater

## Release Assets

Public releases contain the built `main.js`, `manifest.json`, `versions.json`, and optional `styles.css`. If you change plugin code, build before creating a release so the assets match the tagged version.
