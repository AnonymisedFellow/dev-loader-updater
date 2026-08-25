"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  PluginLoaderSettingsTab: () => PluginLoaderSettingsTab,
  default: () => PluginLoaderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/loader-utils.ts
var DEFAULT_SOURCE_NAME = "New Source";
var MANIFEST_FILE_NAME = "manifest.json";
var MAIN_FILE_NAME = "main.js";
var STYLES_FILE_NAME = "styles.css";
var DEFAULT_SETTINGS = {
  sources: [],
  checkOnStartup: true,
  autoInstallUpdates: false
};
function createDefaultSource() {
  return {
    id: createId(),
    pluginId: "",
    displayName: DEFAULT_SOURCE_NAME,
    endpoints: [],
    authToken: "",
    enabled: true
  };
}
function normalizeSource(input) {
  const source = isRecord(input) ? input : {};
  const id = typeof source["id"] === "string" && source["id"].trim() ? source["id"].trim() : createId();
  const pluginId = typeof source["pluginId"] === "string" ? source["pluginId"].trim() : "";
  const displayName = typeof source["displayName"] === "string" && source["displayName"].trim() ? source["displayName"].trim() : DEFAULT_SOURCE_NAME;
  const endpoints = Array.isArray(source["endpoints"]) ? source["endpoints"].filter((candidate) => typeof candidate === "string").map((candidate) => candidate.trim()).filter(Boolean) : [];
  const authToken = typeof source["authToken"] === "string" ? source["authToken"].trim() : "";
  return {
    id,
    pluginId,
    displayName,
    endpoints,
    authToken,
    enabled: source["enabled"] !== false
  };
}
function normalizeSettings(loaded) {
  const data = isRecord(loaded) ? loaded : {};
  const sources = Array.isArray(data["sources"]) ? data["sources"].map((source) => normalizeSource(source)) : [];
  return {
    ...DEFAULT_SETTINGS,
    sources,
    checkOnStartup: data["checkOnStartup"] !== false,
    autoInstallUpdates: data["autoInstallUpdates"] === true
  };
}
function hasCustomDisplayName(source) {
  return !!source.displayName.trim() && source.displayName.trim() !== DEFAULT_SOURCE_NAME;
}
function parseManifest(manifestText, expectedPluginId) {
  const parsed = JSON.parse(manifestText);
  if (!isRecord(parsed) || typeof parsed["id"] !== "string" || !parsed["id"].trim()) {
    throw new Error("manifest is missing a valid id");
  }
  const manifestId = parsed["id"].trim();
  if (!isSafePluginId(manifestId)) {
    throw new Error(`manifest id '${manifestId}' is not a safe plugin id`);
  }
  if (expectedPluginId && manifestId !== expectedPluginId) {
    throw new Error(
      `manifest id ${manifestId} does not match configured plugin id ${expectedPluginId}`
    );
  }
  if (typeof parsed["version"] !== "string" || !parsed["version"].trim()) {
    throw new Error("manifest is missing a valid version");
  }
  return {
    ...parsed,
    id: manifestId
  };
}
function isSafePluginId(pluginId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pluginId);
}
function deriveGiteaLatestReleaseApiUrl(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const releaseIndex = pathSegments.lastIndexOf("releases");
  if (releaseIndex < 2) {
    return null;
  }
  const owner = pathSegments[releaseIndex - 2];
  const repo = pathSegments[releaseIndex - 1];
  if (!owner || !repo) {
    return null;
  }
  const prefixSegments = pathSegments.slice(0, releaseIndex - 2);
  const prefixPath = prefixSegments.length > 0 ? `/${prefixSegments.join("/")}` : "";
  return `${parsed.origin}${prefixPath}/api/v1/repos/${owner}/${repo}/releases/latest`;
}
function deriveDirectPluginAssetUrls(endpoint) {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("source URL must use HTTP or HTTPS");
  }
  const path = parsed.pathname.endsWith("/") ? parsed.pathname : parsed.pathname.toLowerCase().endsWith(`/${MANIFEST_FILE_NAME}`) ? parsed.pathname.slice(0, -MANIFEST_FILE_NAME.length) : `${parsed.pathname}/`;
  const base = new URL(path, parsed.origin);
  const assetUrl = (fileName) => new URL(fileName, base).toString();
  return {
    manifestUrl: assetUrl(MANIFEST_FILE_NAME),
    mainJsUrl: assetUrl(MAIN_FILE_NAME),
    stylesCssUrl: assetUrl(STYLES_FILE_NAME)
  };
}
function compareVersions(left, right) {
  const leftParts = sanitizeVersion(left);
  const rightParts = sanitizeVersion(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}
function redactEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<configured source>";
  }
}
function createAuthHeaders(authToken) {
  const token = authToken.trim();
  return token ? { Authorization: `token ${token}` } : void 0;
}
async function writePluginFilesWithRollback(adapter, paths, contents) {
  const previous = await Promise.all([
    readExistingFile(adapter, paths.manifest),
    readExistingFile(adapter, paths.main),
    readExistingFile(adapter, paths.styles)
  ]);
  try {
    await adapter.write(paths.manifest, contents.manifest);
    await adapter.write(paths.main, contents.main);
    if (contents.styles !== void 0) {
      await adapter.write(paths.styles, contents.styles);
    } else if (previous[2].exists) {
      await adapter.remove(paths.styles);
    }
  } catch (error) {
    await Promise.allSettled([
      restoreFile(adapter, paths.manifest, previous[0]),
      restoreFile(adapter, paths.main, previous[1]),
      restoreFile(adapter, paths.styles, previous[2])
    ]);
    throw error;
  }
}
function sanitizeVersion(version) {
  return version.replace(/^[^\d]*/, "").split(/[^\d]+/).filter(Boolean).map((segment) => Number.parseInt(segment, 10)).map((value) => Number.isFinite(value) ? value : 0);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
async function readExistingFile(adapter, path) {
  if (!await adapter.exists(path)) {
    return { exists: false };
  }
  return {
    exists: true,
    content: await adapter.read(path)
  };
}
async function restoreFile(adapter, path, previous) {
  if (previous.exists) {
    await adapter.write(path, previous.content ?? "");
    return;
  }
  if (await adapter.exists(path)) {
    await adapter.remove(path);
  }
}
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// src/main.ts
function getSourceHeading(source) {
  if (source.pluginId.trim()) {
    return source.pluginId.trim();
  }
  if (hasCustomDisplayName(source)) {
    return source.displayName.trim();
  }
  return "New source";
}
function getSourceDisplayName(source, manifest) {
  if (hasCustomDisplayName(source)) {
    return source.displayName.trim();
  }
  if (typeof manifest?.name === "string" && manifest.name.trim()) {
    return manifest.name.trim();
  }
  if (source.pluginId.trim()) {
    return source.pluginId.trim();
  }
  return "New source";
}
function syncSourceMetadataFromManifest(source, manifest) {
  let changed = false;
  const manifestId = manifest.id.trim();
  if (source.pluginId !== manifestId) {
    source.pluginId = manifestId;
    changed = true;
  }
  if (!hasCustomDisplayName(source) && typeof manifest.name === "string" && manifest.name.trim()) {
    const nextDisplayName = manifest.name.trim();
    if (source.displayName !== nextDisplayName) {
      source.displayName = nextDisplayName;
      changed = true;
    }
  }
  return changed;
}
var PluginLoaderPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = normalizeSettings(null);
  }
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "dev-loader-updater-install-or-update-all",
      name: "Install or update all configured plugin sources",
      callback: async () => {
        await this.installOrUpdateAll(true);
      }
    });
    this.addCommand({
      id: "dev-loader-updater-check-updates",
      name: "Check all configured plugin sources for updates",
      callback: async () => {
        await this.checkForUpdates(false);
      }
    });
    this.addSettingTab(new PluginLoaderSettingsTab(this.app, this));
    if (this.settings.checkOnStartup) {
      void this.checkForUpdates(true);
    }
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = normalizeSettings(loaded);
  }
  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }
  async syncSourceMetadata(source, manifest) {
    if (syncSourceMetadataFromManifest(source, manifest)) {
      await this.saveSettings();
    }
  }
  async installOrUpdateSource(source, askBeforeInstall) {
    try {
      const remote = await this.fetchRemotePluginFiles(source);
      await this.syncSourceMetadata(source, remote.manifest);
      const pluginId = remote.manifest.id;
      const sourceName = getSourceDisplayName(source, remote.manifest);
      const remoteVersion = remote.manifest.version ?? "unknown";
      const localManifest = await this.readInstalledManifest(pluginId);
      const localVersion = localManifest?.version ?? "not installed";
      if (askBeforeInstall) {
        const confirmed = await ConfirmInstallModal.open(
          this.app,
          sourceName,
          pluginId,
          localVersion,
          remoteVersion,
          remote.endpoint
        );
        if (!confirmed) {
          new import_obsidian.Notice(`Dev Loader Updater: skipped ${sourceName}`);
          return false;
        }
      }
      await this.writePluginFiles(pluginId, remote);
      await this.applyInstalledPluginState(pluginId);
      new import_obsidian.Notice(
        `Dev Loader Updater: installed ${sourceName} (${remoteVersion}) from ${redactEndpoint(remote.endpoint)}. Restart Obsidian if it was already enabled.`
      );
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new import_obsidian.Notice(`Dev Loader Updater: failed ${getSourceDisplayName(source)} - ${reason}`);
      return false;
    }
  }
  async testSourceConnectivity(source) {
    const remote = await this.fetchRemotePluginFiles(source, true);
    await this.syncSourceMetadata(source, remote.manifest);
    return remote;
  }
  async installOrUpdateAll(askBeforeInstall) {
    const enabledSources = this.settings.sources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      new import_obsidian.Notice("Dev Loader Updater: no enabled sources configured");
      return;
    }
    for (const source of enabledSources) {
      await this.installOrUpdateSource(source, askBeforeInstall);
    }
  }
  async checkForUpdates(silentWhenUpToDate) {
    const enabledSources = this.settings.sources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      return;
    }
    let updatesFound = 0;
    for (const source of enabledSources) {
      try {
        const remote = await this.fetchRemotePluginFiles(source, true);
        await this.syncSourceMetadata(source, remote.manifest);
        const pluginId = remote.manifest.id;
        const sourceName = getSourceDisplayName(source, remote.manifest);
        const localManifest = await this.readInstalledManifest(pluginId);
        const localVersion = localManifest?.version ?? "0.0.0";
        const remoteVersion = remote.manifest.version ?? "0.0.0";
        const hasUpdate = compareVersions(remoteVersion, localVersion) > 0;
        if (!localManifest) {
          new import_obsidian.Notice(
            `Dev Loader Updater: ${sourceName} is not installed locally. Run install command to add it.`
          );
          continue;
        }
        if (!hasUpdate) {
          continue;
        }
        updatesFound += 1;
        if (this.settings.autoInstallUpdates) {
          await this.installOrUpdateSource(source, false);
          continue;
        }
        new import_obsidian.Notice(
          `Dev Loader Updater: update available for ${sourceName} (${localVersion} -> ${remoteVersion})`,
          1e4
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        new import_obsidian.Notice(
          `Dev Loader Updater: update check failed for ${getSourceDisplayName(source)} - ${reason}`
        );
      }
    }
    if (updatesFound === 0 && !silentWhenUpToDate) {
      new import_obsidian.Notice("Dev Loader Updater: all enabled sources are up to date");
    }
  }
  async fetchRemotePluginFiles(source, manifestOnly = false) {
    const endpoints = source.endpoints.map((candidate) => candidate.trim()).filter(Boolean);
    if (endpoints.length === 0) {
      throw new Error("no endpoints configured");
    }
    const errors = [];
    for (const endpoint of endpoints) {
      try {
        const endpointAuthToken = deriveGiteaLatestReleaseApiUrl(endpoint) ? source.authToken : "";
        const releaseAssets = await this.tryResolveLatestReleaseAssetUrls(endpoint, endpointAuthToken) ?? deriveDirectPluginAssetUrls(endpoint);
        const manifestText = await this.httpGetText(releaseAssets.manifestUrl, endpointAuthToken);
        const manifest = parseManifest(manifestText, source.pluginId);
        if (manifestOnly) {
          return {
            endpoint,
            manifest,
            mainJs: ""
          };
        }
        const mainJs = await this.httpGetText(releaseAssets.mainJsUrl, endpointAuthToken);
        let stylesCss;
        if (releaseAssets.stylesCssUrl) {
          try {
            stylesCss = await this.httpGetText(releaseAssets.stylesCssUrl, endpointAuthToken);
          } catch {
            stylesCss = void 0;
          }
        }
        return {
          endpoint,
          manifest,
          mainJs,
          ...stylesCss !== void 0 ? { stylesCss } : {}
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${redactEndpoint(endpoint)}: ${reason}`);
      }
    }
    throw new Error(`all configured release URLs failed: ${errors.join(" | ")}`);
  }
  async httpGetText(url, authToken = "") {
    const headers = createAuthHeaders(authToken);
    const response = await (0, import_obsidian.requestUrl)({
      url,
      method: "GET",
      ...headers ? { headers } : {},
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} for ${redactEndpoint(url)}`);
    }
    return response.text;
  }
  async tryResolveLatestReleaseAssetUrls(endpoint, authToken) {
    const apiUrl = deriveGiteaLatestReleaseApiUrl(endpoint);
    if (!apiUrl) {
      return null;
    }
    const headers = createAuthHeaders(authToken);
    const response = await (0, import_obsidian.requestUrl)({
      url: apiUrl,
      method: "GET",
      ...headers ? { headers } : {},
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    let release;
    try {
      release = JSON.parse(response.text);
    } catch {
      return null;
    }
    const assetsByName = /* @__PURE__ */ new Map();
    for (const asset of release.assets ?? []) {
      if (!asset?.name || !asset.browser_download_url) {
        continue;
      }
      assetsByName.set(asset.name.toLowerCase(), asset.browser_download_url);
    }
    const manifestUrl = assetsByName.get(MANIFEST_FILE_NAME);
    const mainJsUrl = assetsByName.get(MAIN_FILE_NAME);
    if (!manifestUrl || !mainJsUrl) {
      return null;
    }
    if (!isSameOrigin(endpoint, manifestUrl) || !isSameOrigin(endpoint, mainJsUrl)) {
      return null;
    }
    const stylesCssUrl = assetsByName.get(STYLES_FILE_NAME);
    if (stylesCssUrl && isSameOrigin(endpoint, stylesCssUrl)) {
      return {
        manifestUrl,
        mainJsUrl,
        stylesCssUrl
      };
    }
    return {
      manifestUrl,
      mainJsUrl
    };
  }
  async readInstalledManifest(pluginId) {
    const adapter = this.app.vault.adapter;
    const manifestPath = (0, import_obsidian.normalizePath)(
      `${this.app.vault.configDir}/plugins/${pluginId}/manifest.json`
    );
    if (!await adapter.exists(manifestPath)) {
      return null;
    }
    const raw = await adapter.read(manifestPath);
    return parseManifest(raw, pluginId);
  }
  async writePluginFiles(pluginId, remote) {
    const adapter = this.app.vault.adapter;
    const pluginDir = (0, import_obsidian.normalizePath)(`${this.app.vault.configDir}/plugins/${pluginId}`);
    await ensureDirectory(adapter, pluginDir);
    const files = {
      manifest: (0, import_obsidian.normalizePath)(`${pluginDir}/manifest.json`),
      main: (0, import_obsidian.normalizePath)(`${pluginDir}/main.js`),
      styles: (0, import_obsidian.normalizePath)(`${pluginDir}/styles.css`)
    };
    const contents = {
      manifest: JSON.stringify(remote.manifest, null, 2),
      main: remote.mainJs,
      ...remote.stylesCss !== void 0 ? { styles: remote.stylesCss } : {}
    };
    await writePluginFilesWithRollback(adapter, files, contents);
  }
  async applyInstalledPluginState(pluginId) {
    await this.tryEnablePlugin(pluginId);
  }
  async tryEnablePlugin(pluginId) {
    const pluginsApi = this.app.plugins;
    if (!pluginsApi) {
      return;
    }
    try {
      if (pluginsApi.enablePluginAndSave) {
        await pluginsApi.enablePluginAndSave(pluginId);
        return;
      }
      if (pluginsApi.loadPlugin) {
        await pluginsApi.loadPlugin(pluginId);
      }
    } catch {
    }
  }
};
function isSameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
var PluginLoaderSettingsTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.pendingEndpointCounts = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Check on startup").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.checkOnStartup);
      toggle.onChange(async (value) => {
        this.plugin.settings.checkOnStartup = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Auto-install updates").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.autoInstallUpdates);
      toggle.onChange(async (value) => {
        this.plugin.settings.autoInstallUpdates = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Actions").setHeading();
    new import_obsidian.Setting(containerEl).setName("All enabled sources").addButton((button) => {
      button.setButtonText("Check");
      button.onClick(async () => {
        await this.plugin.checkForUpdates(false);
      });
    }).addButton((button) => {
      button.setButtonText("Install/Update");
      button.setCta();
      button.onClick(async () => {
        await this.plugin.installOrUpdateAll(true);
      });
    });
    new import_obsidian.Setting(containerEl).setName("Sources").setHeading();
    if (this.plugin.settings.sources.length === 0) {
      new import_obsidian.Setting(containerEl).setName("No sources configured");
    }
    this.plugin.settings.sources.forEach((source) => {
      this.renderSourceCard(containerEl, source);
    });
    new import_obsidian.Setting(containerEl).setName("Add source").setHeading().addButton((button) => {
      button.setButtonText("Add");
      button.setCta();
      button.onClick(async () => {
        this.plugin.settings.sources.push(createDefaultSource());
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }
  renderSourceCard(containerEl, source) {
    const heading = new import_obsidian.Setting(containerEl).setName(getSourceHeading(source)).setHeading().addToggle((toggle) => {
      toggle.setValue(source.enabled);
      toggle.onChange(async (value) => {
        const currentSource = this.getCurrentSource(source.id);
        if (!currentSource) {
          return;
        }
        currentSource.enabled = value;
        await this.plugin.saveSettings();
      });
    });
    heading.addExtraButton((button) => {
      button.setIcon("trash");
      button.setTooltip("Remove source");
      button.onClick(async () => {
        this.plugin.settings.sources = this.plugin.settings.sources.filter(
          (entry) => entry.id !== source.id
        );
        await this.plugin.saveSettings();
        this.display();
      });
    });
    const pendingEndpointCount = this.getPendingEndpointCount(source);
    const endpointCount = Math.max(1, source.endpoints.length + pendingEndpointCount);
    for (let index = 0; index < endpointCount; index += 1) {
      const isPending = index >= source.endpoints.length;
      const endpoint = source.endpoints[index] ?? "";
      let persistedIndex = isPending ? null : index;
      const endpointSetting = new import_obsidian.Setting(containerEl).setName(`Release URL ${index + 1}`).addText((text) => {
        text.setValue(endpoint);
        text.onChange(async (value) => {
          const currentSource = this.getCurrentSource(source.id);
          if (!currentSource) {
            return;
          }
          const normalized = value.trim();
          if (persistedIndex === null && normalized) {
            currentSource.endpoints.push(normalized);
            persistedIndex = currentSource.endpoints.length - 1;
            this.setPendingEndpointCount(
              currentSource,
              this.getPendingEndpointCount(currentSource) - 1
            );
          } else if (persistedIndex !== null && normalized) {
            currentSource.endpoints[persistedIndex] = normalized;
          } else if (persistedIndex !== null) {
            currentSource.endpoints.splice(persistedIndex, 1);
            persistedIndex = null;
            this.setPendingEndpointCount(
              currentSource,
              this.getPendingEndpointCount(currentSource) + 1
            );
          } else {
            return;
          }
          await this.plugin.saveSettings();
        });
      });
      endpointSetting.addExtraButton((button) => {
        button.setIcon("trash");
        button.setTooltip("Remove URL");
        button.onClick(async () => {
          const currentSource = this.getCurrentSource(source.id);
          if (!currentSource) {
            return;
          }
          if (persistedIndex === null) {
            this.setPendingEndpointCount(
              currentSource,
              this.getPendingEndpointCount(currentSource) - 1
            );
          } else {
            currentSource.endpoints.splice(persistedIndex, 1);
            persistedIndex = null;
            this.setPendingEndpointCount(
              currentSource,
              this.getPendingEndpointCount(currentSource) + 1
            );
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });
    }
    new import_obsidian.Setting(containerEl).setName("Add URL").addButton((button) => {
      button.setButtonText("Add");
      button.onClick(() => {
        const currentSource = this.getCurrentSource(source.id);
        if (!currentSource) {
          return;
        }
        this.setPendingEndpointCount(
          currentSource,
          this.getPendingEndpointCount(currentSource) + 1
        );
        this.display();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Gitea token").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(source.authToken);
      text.onChange(async (value) => {
        const currentSource = this.getCurrentSource(source.id);
        if (!currentSource) {
          return;
        }
        currentSource.authToken = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Actions").addButton((button) => {
      button.setButtonText("Test");
      button.onClick(async () => {
        const currentSource = this.getCurrentSource(source.id) ?? source;
        try {
          const remote = await this.plugin.testSourceConnectivity(currentSource);
          new import_obsidian.Notice(
            `Dev Loader Updater: ${getSourceDisplayName(currentSource, remote.manifest)} reachable via ${redactEndpoint(remote.endpoint)}`
          );
          this.display();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          new import_obsidian.Notice(
            `Dev Loader Updater: test failed for ${getSourceDisplayName(currentSource)} - ${reason}`
          );
        }
      });
    }).addButton((button) => {
      button.setButtonText("Install/Update");
      button.setCta();
      button.onClick(async () => {
        await this.plugin.installOrUpdateSource(this.getCurrentSource(source.id) ?? source, true);
      });
    });
  }
  getCurrentSource(sourceId) {
    return this.plugin.settings.sources.find((source) => source.id === sourceId);
  }
  getPendingEndpointCount(source) {
    const existing = this.pendingEndpointCounts.get(source.id);
    if (existing !== void 0) {
      return existing;
    }
    const initial = source.endpoints.length === 0 ? 1 : 0;
    this.pendingEndpointCounts.set(source.id, initial);
    return initial;
  }
  setPendingEndpointCount(source, count) {
    this.pendingEndpointCounts.set(source.id, Math.max(0, count));
  }
};
var ConfirmInstallModal = class _ConfirmInstallModal extends import_obsidian.Modal {
  constructor(app, sourceName, pluginId, localVersion, remoteVersion, endpoint) {
    super(app);
    this.resolvePromise = null;
    this.sourceName = sourceName;
    this.pluginId = pluginId;
    this.localVersion = localVersion;
    this.remoteVersion = remoteVersion;
    this.endpoint = endpoint;
  }
  static open(app, sourceName, pluginId, localVersion, remoteVersion, endpoint) {
    const modal = new _ConfirmInstallModal(
      app,
      sourceName,
      pluginId,
      localVersion,
      remoteVersion,
      endpoint
    );
    return new Promise((resolve) => {
      modal.resolvePromise = resolve;
      modal.open();
    });
  }
  onOpen() {
    this.contentEl.empty();
    new import_obsidian.Setting(this.contentEl).setName("Confirm plugin install/update").setDesc(`${this.sourceName} (${this.pluginId})`).setHeading();
    new import_obsidian.Setting(this.contentEl).setName("Current version").setDesc(this.localVersion);
    new import_obsidian.Setting(this.contentEl).setName("Remote version").setDesc(this.remoteVersion);
    new import_obsidian.Setting(this.contentEl).setName("Selected endpoint").setDesc(redactEndpoint(this.endpoint));
    new import_obsidian.Setting(this.contentEl).addButton((button) => {
      button.setButtonText("Cancel");
      button.onClick(() => {
        this.closeWithValue(false);
      });
    }).addButton((button) => {
      button.setButtonText("Install");
      button.setCta();
      button.onClick(() => {
        this.closeWithValue(true);
      });
    });
  }
  onClose() {
    this.contentEl.empty();
    if (this.resolvePromise) {
      const resolve = this.resolvePromise;
      this.resolvePromise = null;
      resolve(false);
    }
  }
  closeWithValue(value) {
    if (this.resolvePromise) {
      const resolve = this.resolvePromise;
      this.resolvePromise = null;
      resolve(value);
    }
    this.close();
  }
};
async function ensureDirectory(adapter, fullPath) {
  const parts = fullPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) {
      await adapter.mkdir(current);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PluginLoaderSettingsTab
});
//# sourceMappingURL=main.js.map
