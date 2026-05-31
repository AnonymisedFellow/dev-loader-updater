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
  default: () => PluginLoaderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
var DEFAULT_SOURCE = {
  id: createId(),
  pluginId: "",
  displayName: "New Source",
  endpoints: [],
  manifestPath: "manifest.json",
  mainPath: "main.js",
  stylesPath: "styles.css",
  branch: "main",
  enabled: true,
  authToken: ""
};
var DEFAULT_SETTINGS = {
  sources: [],
  checkOnStartup: true,
  autoInstallUpdates: false
};
function normalizeEndpointLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}
function getLocalNetworkEndpoint(source) {
  return source.endpoints[0] ?? "";
}
function getTailscaleEndpoint(source) {
  return source.endpoints[1] ?? "";
}
function setVerifiedEndpoints(source, localNetworkEndpoint, tailscaleEndpoint) {
  source.endpoints = normalizeEndpointLines([localNetworkEndpoint.trim(), tailscaleEndpoint.trim()].join("\n")).slice(0, 2);
}
function hasCustomDisplayName(source) {
  return !!source.displayName.trim() && source.displayName.trim() !== DEFAULT_SOURCE.displayName;
}
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
    this.settings = DEFAULT_SETTINGS;
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
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded ?? {},
      sources: (loaded?.sources ?? []).map((source) => ({
        ...DEFAULT_SOURCE,
        ...source,
        id: source.id || createId()
      }))
    };
  }
  async saveSettings() {
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
      await this.tryEnablePlugin(pluginId);
      new import_obsidian.Notice(
        `Dev Loader Updater: installed ${sourceName} (${remoteVersion}) from ${remote.endpoint}`
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
        new import_obsidian.Notice(`Dev Loader Updater: update check failed for ${getSourceDisplayName(source)} - ${reason}`);
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
        if (isSshEndpoint(endpoint)) {
          if (import_obsidian.Platform.isMobile) {
            throw new Error("SSH endpoints are desktop-only; put HTTP(S) endpoints first for mobile fallback");
          }
          const manifestText2 = await this.readSshFile(endpoint, source.manifestPath);
          const manifest2 = parseManifest(manifestText2, source.pluginId);
          if (manifestOnly) {
            return {
              endpoint,
              manifest: manifest2,
              mainJs: ""
            };
          }
          const mainJs2 = await this.readSshFile(endpoint, source.mainPath);
          let stylesCss2;
          try {
            stylesCss2 = await this.readSshFile(endpoint, source.stylesPath);
          } catch {
            stylesCss2 = void 0;
          }
          return {
            endpoint,
            manifest: manifest2,
            mainJs: mainJs2,
            ...stylesCss2 ? { stylesCss: stylesCss2 } : {}
          };
        }
        const manifestUrl = joinUrl(endpoint, source.manifestPath);
        const manifestText = await this.httpGetText(manifestUrl, source.authToken);
        const manifest = parseManifest(manifestText, source.pluginId);
        if (manifestOnly) {
          return {
            endpoint,
            manifest,
            mainJs: ""
          };
        }
        const mainJsUrl = joinUrl(endpoint, source.mainPath);
        const mainJs = await this.httpGetText(mainJsUrl, source.authToken);
        let stylesCss;
        try {
          stylesCss = await this.httpGetText(joinUrl(endpoint, source.stylesPath), source.authToken);
        } catch {
          stylesCss = void 0;
        }
        return {
          endpoint,
          manifest,
          mainJs,
          ...stylesCss ? { stylesCss } : {}
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${endpoint}: ${reason}`);
      }
    }
    throw new Error(`all endpoints failed; ${errors.join(" | ")}`);
  }
  async httpGetText(url, authToken) {
    const headers = {};
    if (authToken?.trim()) {
      headers.Authorization = `token ${authToken.trim()}`;
    }
    const response = await (0, import_obsidian.requestUrl)({
      url,
      method: "GET",
      headers,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text;
  }
  async readSshFile(endpoint, relativeFilePath) {
    const parsed = parseSshEndpoint(endpoint);
    if (!parsed) {
      throw new Error("invalid SSH endpoint format; expected ssh://user@host/absolute/path/to/plugin-dir");
    }
    const { userHost, remoteRootPath } = parsed;
    const normalizedPath = relativeFilePath.replaceAll("\\", "/").replace(/^\/+/, "");
    const remotePath = `${remoteRootPath.replace(/\/+$/, "")}/${normalizedPath}`;
    const { stdout, stderr } = await execFileAsync("ssh", [userHost, `cat '${remotePath}'`], {
      maxBuffer: 8 * 1024 * 1024
    });
    if (stderr?.trim()) {
      throw new Error(stderr.trim());
    }
    return typeof stdout === "string" ? stdout : stdout.toString("utf8");
  }
  async readInstalledManifest(pluginId) {
    const adapter = this.app.vault.adapter;
    const manifestPath = (0, import_obsidian.normalizePath)(`${this.app.vault.configDir}/plugins/${pluginId}/manifest.json`);
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
    await adapter.write((0, import_obsidian.normalizePath)(`${pluginDir}/manifest.json`), JSON.stringify(remote.manifest, null, 2));
    await adapter.write((0, import_obsidian.normalizePath)(`${pluginDir}/main.js`), remote.mainJs);
    if (remote.stylesCss?.length) {
      await adapter.write((0, import_obsidian.normalizePath)(`${pluginDir}/styles.css`), remote.stylesCss);
    }
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
var PluginLoaderSettingsTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Dev Loader Updater" });
    containerEl.createEl("p", {
      text: "Add the two verified release URLs for a private plugin: one local network URL and one Tailscale URL."
    });
    containerEl.createEl("p", {
      text: "The loader reads the manifest, detects the plugin id automatically, and tries whichever verified URL works first."
    });
    containerEl.createEl("h3", { text: "Behavior" });
    new import_obsidian.Setting(containerEl).setName("Check on startup").setDesc("Look for updates when Obsidian starts.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.checkOnStartup).onChange(async (value) => {
        this.plugin.settings.checkOnStartup = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-install updates").setDesc("Install newer versions automatically after startup checks.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoInstallUpdates).onChange(async (value) => {
        this.plugin.settings.autoInstallUpdates = value;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Actions" });
    new import_obsidian.Setting(containerEl).setName("Run across all enabled sources").setDesc("Check for updates or install now.").addButton(
      (button) => button.setButtonText("Check").onClick(async () => {
        await this.plugin.checkForUpdates(false);
      })
    ).addButton(
      (button) => button.setButtonText("Install/Update").setCta().onClick(async () => {
        await this.plugin.installOrUpdateAll(true);
      })
    );
    containerEl.createEl("h3", { text: "Sources" });
    if (this.plugin.settings.sources.length === 0) {
      containerEl.createEl("p", {
        text: "No sources yet. Add one and fill in the local network URL and/or Tailscale URL."
      });
    }
    this.plugin.settings.sources.forEach((source) => {
      this.renderSourceCard(containerEl, source);
    });
    new import_obsidian.Setting(containerEl).setName("Add source").setDesc("Create a new source entry with the default simple fields.").addButton(
      (button) => button.setButtonText("Add").setCta().onClick(async () => {
        this.plugin.settings.sources.push({ ...DEFAULT_SOURCE, id: createId() });
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
  renderSourceCard(containerEl, source) {
    containerEl.createEl("h4", { text: getSourceHeading(source) });
    if (!getLocalNetworkEndpoint(source) && !getTailscaleEndpoint(source)) {
      containerEl.createEl("p", {
        text: "Required here: a local network URL, a Tailscale URL, or both. The plugin id is detected automatically."
      });
    }
    new import_obsidian.Setting(containerEl).setName("Enabled").setDesc("Use this source for checks and installs.").addToggle(
      (toggle) => toggle.setValue(source.enabled).onChange(async (value) => {
        source.enabled = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Detected plugin id").setDesc("Read from the remote manifest after the first successful test, check, or install.").addText(
      (text) => text.setPlaceholder("Detected automatically").setValue(source.pluginId).setDisabled(true)
    );
    new import_obsidian.Setting(containerEl).setName("Local network URL").setDesc("Verified path 1. Use the plugin release folder served on your local IP or LAN host.").addText(
      (text) => text.setPlaceholder("http://192.168.x.x/path/to/plugin").setValue(getLocalNetworkEndpoint(source)).onChange(async (value) => {
        setVerifiedEndpoints(source, value, getTailscaleEndpoint(source));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Tailscale URL").setDesc("Verified path 2. Use the plugin release folder exposed through your Tailscale address.").addText(
      (text) => text.setPlaceholder("https://host.tailnet/path/to/plugin").setValue(getTailscaleEndpoint(source)).onChange(async (value) => {
        setVerifiedEndpoints(source, getLocalNetworkEndpoint(source), value);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Source actions").setDesc("Test the verified URLs, install now, or remove this source.").addButton(
      (button) => button.setButtonText("Test").onClick(async () => {
        try {
          const remote = await this.plugin.testSourceConnectivity(source);
          new import_obsidian.Notice(
            `Dev Loader Updater: ${getSourceDisplayName(source, remote.manifest)} reachable via ${remote.endpoint}`
          );
          this.display();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          new import_obsidian.Notice(`Dev Loader Updater: test failed for ${getSourceDisplayName(source)} - ${reason}`);
        }
      })
    ).addButton(
      (button) => button.setButtonText("Install/Update").setCta().onClick(async () => {
        await this.plugin.installOrUpdateSource(source, true);
      })
    ).addButton(
      (button) => button.setButtonText("Remove").onClick(async () => {
        this.plugin.settings.sources = this.plugin.settings.sources.filter((entry) => entry.id !== source.id);
        await this.plugin.saveSettings();
        this.display();
      })
    );
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
    this.contentEl.createEl("h2", { text: "Confirm plugin install/update" });
    this.contentEl.createEl("p", {
      text: `${this.sourceName} (${this.pluginId})`
    });
    this.contentEl.createEl("p", {
      text: `Current version: ${this.localVersion}`
    });
    this.contentEl.createEl("p", {
      text: `Remote version: ${this.remoteVersion}`
    });
    this.contentEl.createEl("p", {
      text: `Selected endpoint: ${this.endpoint}`
    });
    new import_obsidian.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => {
        this.closeWithValue(false);
      })
    ).addButton(
      (button) => button.setButtonText("Install").setCta().onClick(() => {
        this.closeWithValue(true);
      })
    );
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
function parseManifest(manifestText, expectedPluginId) {
  const parsed = JSON.parse(manifestText);
  if (!parsed.id) {
    throw new Error("manifest is missing id");
  }
  if (expectedPluginId && parsed.id !== expectedPluginId) {
    throw new Error(`manifest id ${parsed.id} does not match configured plugin id ${expectedPluginId}`);
  }
  return parsed;
}
function joinUrl(baseUrl, relativePath) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = relativePath.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}
function isSshEndpoint(endpoint) {
  return endpoint.startsWith("ssh://");
}
function parseSshEndpoint(endpoint) {
  if (endpoint.startsWith("ssh://")) {
    try {
      const parsed = new URL(endpoint);
      if (!parsed.username || !parsed.hostname) {
        return null;
      }
      const userHost = `${parsed.username}@${parsed.hostname}`;
      const remoteRootPath = parsed.pathname;
      return remoteRootPath ? { userHost, remoteRootPath } : null;
    } catch {
      return null;
    }
  }
  return null;
}
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
function sanitizeVersion(version) {
  return version.replace(/^[^\d]*/, "").split(/[^\d]+/).filter(Boolean).map((segment) => Number.parseInt(segment, 10)).map((value) => Number.isFinite(value) ? value : 0);
}
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
//# sourceMappingURL=main.js.map
