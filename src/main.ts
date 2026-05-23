import {
  App,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl,
} from 'obsidian';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface LoaderSource {
  id: string;
  pluginId: string;
  displayName: string;
  endpoints: string[];
  manifestPath: string;
  mainPath: string;
  stylesPath: string;
  branch: string;
  enabled: boolean;
  authToken: string;
}

interface PluginLoaderSettings {
  sources: LoaderSource[];
  checkOnStartup: boolean;
  autoInstallUpdates: boolean;
}

interface RemotePluginFiles {
  endpoint: string;
  manifest: PluginManifestLike;
  mainJs: string;
  stylesCss?: string;
}

interface PluginManifestLike {
  id: string;
  name?: string;
  version?: string;
  minAppVersion?: string;
  description?: string;
  [key: string]: unknown;
}

const DEFAULT_SOURCE: LoaderSource = {
  id: createId(),
  pluginId: '',
  displayName: 'New Source',
  endpoints: [],
  manifestPath: 'manifest.json',
  mainPath: 'main.js',
  stylesPath: 'styles.css',
  branch: 'main',
  enabled: true,
  authToken: '',
};

const DEFAULT_SETTINGS: PluginLoaderSettings = {
  sources: [],
  checkOnStartup: true,
  autoInstallUpdates: false,
};

export default class PluginLoaderPlugin extends Plugin {
  settings: PluginLoaderSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: 'plugin-loader-install-or-update-all',
      name: 'Install or update all configured plugin sources',
      callback: async () => {
        await this.installOrUpdateAll(true);
      },
    });

    this.addCommand({
      id: 'plugin-loader-check-updates',
      name: 'Check all configured plugin sources for updates',
      callback: async () => {
        await this.checkForUpdates(false);
      },
    });

    this.addSettingTab(new PluginLoaderSettingsTab(this.app, this));

    if (this.settings.checkOnStartup) {
      void this.checkForUpdates(true);
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PluginLoaderSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      sources: (loaded?.sources ?? []).map((source) => ({
        ...DEFAULT_SOURCE,
        ...source,
        id: source.id || createId(),
      })),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async installOrUpdateSource(source: LoaderSource, askBeforeInstall: boolean): Promise<boolean> {
    try {
      const remote = await this.fetchRemotePluginFiles(source);
      const remoteVersion = remote.manifest.version ?? 'unknown';
      const localManifest = await this.readInstalledManifest(source.pluginId);
      const localVersion = localManifest?.version ?? 'not installed';

      if (askBeforeInstall) {
        const confirmed = await ConfirmInstallModal.open(
          this.app,
          source.displayName,
          source.pluginId,
          localVersion,
          remoteVersion,
          remote.endpoint,
        );

        if (!confirmed) {
          new Notice(`Plugin Loader: skipped ${source.displayName}`);
          return false;
        }
      }

      await this.writePluginFiles(source.pluginId, remote);
      await this.tryEnablePlugin(source.pluginId);

      new Notice(
        `Plugin Loader: installed ${source.displayName} (${remoteVersion}) from ${remote.endpoint}`,
      );
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(`Plugin Loader: failed ${source.displayName} - ${reason}`);
      return false;
    }
  }

  async testSourceConnectivity(source: LoaderSource): Promise<RemotePluginFiles> {
    return this.fetchRemotePluginFiles(source, true);
  }

  async installOrUpdateAll(askBeforeInstall: boolean): Promise<void> {
    const enabledSources = this.settings.sources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      new Notice('Plugin Loader: no enabled sources configured');
      return;
    }

    for (const source of enabledSources) {
      if (!source.pluginId.trim()) {
        new Notice(`Plugin Loader: source ${source.displayName} is missing plugin id`);
        continue;
      }
      await this.installOrUpdateSource(source, askBeforeInstall);
    }
  }

  async checkForUpdates(silentWhenUpToDate: boolean): Promise<void> {
    const enabledSources = this.settings.sources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      return;
    }

    let updatesFound = 0;
    for (const source of enabledSources) {
      if (!source.pluginId.trim()) {
        continue;
      }

      try {
        const localManifest = await this.readInstalledManifest(source.pluginId);
        const remote = await this.fetchRemotePluginFiles(source, true);

        const localVersion = localManifest?.version ?? '0.0.0';
        const remoteVersion = remote.manifest.version ?? '0.0.0';
        const hasUpdate = compareVersions(remoteVersion, localVersion) > 0;

        if (!localManifest) {
          new Notice(
            `Plugin Loader: ${source.displayName} is not installed locally. Run install command to add it.`,
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

        new Notice(
          `Plugin Loader: update available for ${source.displayName} (${localVersion} -> ${remoteVersion})`,
          10000,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        new Notice(`Plugin Loader: update check failed for ${source.displayName} - ${reason}`);
      }
    }

    if (updatesFound === 0 && !silentWhenUpToDate) {
      new Notice('Plugin Loader: all enabled sources are up to date');
    }
  }

  private async fetchRemotePluginFiles(
    source: LoaderSource,
    manifestOnly = false,
  ): Promise<RemotePluginFiles> {
    const endpoints = source.endpoints.map((candidate) => candidate.trim()).filter(Boolean);
    if (endpoints.length === 0) {
      throw new Error('no endpoints configured');
    }

    const errors: string[] = [];
    for (const endpoint of endpoints) {
      try {
        if (isSshEndpoint(endpoint)) {
          if (Platform.isMobile) {
            throw new Error('SSH endpoints are desktop-only; put HTTP(S) endpoints first for mobile fallback');
          }

          const manifestText = await this.readSshFile(endpoint, source.manifestPath);
          const manifest = parseManifest(manifestText, source.pluginId);

          if (manifestOnly) {
            return {
              endpoint,
              manifest,
              mainJs: '',
            };
          }

          const mainJs = await this.readSshFile(endpoint, source.mainPath);
          let stylesCss: string | undefined;
          try {
            stylesCss = await this.readSshFile(endpoint, source.stylesPath);
          } catch {
            stylesCss = undefined;
          }

          return {
            endpoint,
            manifest,
            mainJs,
            ...(stylesCss ? { stylesCss } : {}),
          };
        }

        const manifestUrl = joinUrl(endpoint, source.manifestPath);
        const manifestText = await this.httpGetText(manifestUrl, source.authToken);
        const manifest = parseManifest(manifestText, source.pluginId);

        if (manifestOnly) {
          return {
            endpoint,
            manifest,
            mainJs: '',
          };
        }

        const mainJsUrl = joinUrl(endpoint, source.mainPath);
        const mainJs = await this.httpGetText(mainJsUrl, source.authToken);

        let stylesCss: string | undefined;
        try {
          stylesCss = await this.httpGetText(joinUrl(endpoint, source.stylesPath), source.authToken);
        } catch {
          stylesCss = undefined;
        }

        return {
          endpoint,
          manifest,
          mainJs,
          ...(stylesCss ? { stylesCss } : {}),
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${endpoint}: ${reason}`);
      }
    }

    throw new Error(`all endpoints failed; ${errors.join(' | ')}`);
  }

  private async httpGetText(url: string, authToken?: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (authToken?.trim()) {
      headers.Authorization = `token ${authToken.trim()}`;
    }

    const response = await requestUrl({
      url,
      method: 'GET',
      headers,
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.text;
  }

  private async readSshFile(endpoint: string, relativeFilePath: string): Promise<string> {
    const parsed = parseSshEndpoint(endpoint);
    if (!parsed) {
      throw new Error('invalid SSH endpoint format; expected ssh://user@host/absolute/path/to/plugin-dir');
    }

    const { userHost, remoteRootPath } = parsed;
    const normalizedPath = relativeFilePath.replaceAll('\\', '/').replace(/^\/+/, '');
    const remotePath = `${remoteRootPath.replace(/\/+$/, '')}/${normalizedPath}`;

    const { stdout, stderr } = await execFileAsync('ssh', [userHost, `cat '${remotePath}'`], {
      maxBuffer: 8 * 1024 * 1024,
    });

    if (stderr?.trim()) {
      throw new Error(stderr.trim());
    }

    return typeof stdout === 'string' ? stdout : stdout.toString('utf8');
  }

  private async readInstalledManifest(pluginId: string): Promise<PluginManifestLike | null> {
    const adapter = this.app.vault.adapter;
    const manifestPath = normalizePath(`${this.app.vault.configDir}/plugins/${pluginId}/manifest.json`);

    if (!(await adapter.exists(manifestPath))) {
      return null;
    }

    const raw = await adapter.read(manifestPath);
    return parseManifest(raw, pluginId);
  }

  private async writePluginFiles(pluginId: string, remote: RemotePluginFiles): Promise<void> {
    const adapter = this.app.vault.adapter;
    const pluginDir = normalizePath(`${this.app.vault.configDir}/plugins/${pluginId}`);
    await ensureDirectory(adapter, pluginDir);

    await adapter.write(normalizePath(`${pluginDir}/manifest.json`), JSON.stringify(remote.manifest, null, 2));
    await adapter.write(normalizePath(`${pluginDir}/main.js`), remote.mainJs);

    if (remote.stylesCss?.length) {
      await adapter.write(normalizePath(`${pluginDir}/styles.css`), remote.stylesCss);
    }
  }

  private async tryEnablePlugin(pluginId: string): Promise<void> {
    const pluginsApi = (this.app as App & {
      plugins?: {
        enablePluginAndSave?: (id: string) => Promise<void>;
        loadPlugin?: (id: string) => Promise<void>;
      };
    }).plugins;

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
      // Installation is still complete even if enabling fails in current session.
    }
  }
}

class PluginLoaderSettingsTab extends PluginSettingTab {
  plugin: PluginLoaderPlugin;

  constructor(app: App, plugin: PluginLoaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Plugin Loader' });
    containerEl.createEl('p', {
      text: 'Configure private plugin endpoints. Endpoints are tried in order for fallback (for example: Tailscale URL, LAN URL, then SSH URL).',
    });

    new Setting(containerEl)
      .setName('Check for updates on startup')
      .setDesc('Fetch remote manifests during plugin startup and report available updates.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.checkOnStartup).onChange(async (value) => {
          this.plugin.settings.checkOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Auto-install updates on startup')
      .setDesc('When enabled, newer remote versions are installed without a confirmation modal.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoInstallUpdates).onChange(async (value) => {
          this.plugin.settings.autoInstallUpdates = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Install or update all now')
      .setDesc('Tests each source endpoint chain, asks for confirmation, then installs.')
      .addButton((button) =>
        button.setButtonText('Run').onClick(async () => {
          await this.plugin.installOrUpdateAll(true);
        }),
      );

    new Setting(containerEl)
      .setName('Check updates now')
      .setDesc('Checks all configured sources for newer versions.')
      .addButton((button) =>
        button.setButtonText('Run').onClick(async () => {
          await this.plugin.checkForUpdates(false);
        }),
      );

    containerEl.createEl('h3', { text: 'Sources' });

    if (this.plugin.settings.sources.length === 0) {
      containerEl.createEl('p', {
        text: 'No sources configured yet. Add one below.',
      });
    }

    this.plugin.settings.sources.forEach((source) => {
      this.renderSourceCard(containerEl, source);
    });

    new Setting(containerEl)
      .setName('Add source')
      .setDesc('Create a new plugin source entry.')
      .addButton((button) =>
        button.setButtonText('Add').setCta().onClick(async () => {
          this.plugin.settings.sources.push({ ...DEFAULT_SOURCE, id: createId() });
          await this.plugin.saveSettings();
          this.display();
        }),
      );
  }

  private renderSourceCard(containerEl: HTMLElement, source: LoaderSource): void {
    containerEl.createEl('h4', { text: source.displayName || 'Untitled Source' });

    new Setting(containerEl)
      .setName('Enabled')
      .setDesc('Only enabled sources are used for install/update checks.')
      .addToggle((toggle) =>
        toggle.setValue(source.enabled).onChange(async (value) => {
          source.enabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Display name')
      .setDesc('Shown in notices and confirmation dialogs.')
      .addText((text) =>
        text.setValue(source.displayName).onChange(async (value) => {
          source.displayName = value.trim() || 'Source';
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Plugin id')
      .setDesc('Folder name under .obsidian/plugins and expected manifest id.')
      .addText((text) =>
        text.setPlaceholder('example-plugin').setValue(source.pluginId).onChange(async (value) => {
          source.pluginId = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Fallback endpoints')
      .setDesc(
        'One per line. HTTP(S) expects a directory containing manifest.json and main.js. SSH expects ssh://user@host/absolute/path/to/plugin-dir.',
      )
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 4;
        textArea
          .setValue(source.endpoints.join('\n'))
          .onChange(async (value) => {
            source.endpoints = value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Branch (SSH only)')
      .setDesc('Reserved for future use; HTTP endpoints ignore this value.')
      .addText((text) =>
        text.setValue(source.branch).onChange(async (value) => {
          source.branch = value.trim() || 'main';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Manifest path')
      .setDesc('Relative path inside endpoint/repository.')
      .addText((text) =>
        text.setValue(source.manifestPath).onChange(async (value) => {
          source.manifestPath = value.trim() || 'manifest.json';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Main script path')
      .setDesc('Relative path for main.js inside endpoint/repository.')
      .addText((text) =>
        text.setValue(source.mainPath).onChange(async (value) => {
          source.mainPath = value.trim() || 'main.js';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Styles path')
      .setDesc('Relative path for styles.css inside endpoint/repository.')
      .addText((text) =>
        text.setValue(source.stylesPath).onChange(async (value) => {
          source.stylesPath = value.trim() || 'styles.css';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Gitea token')
      .setDesc('Optional token used as HTTP Authorization header (token ...).')
      .addText((text) =>
        text
          .setPlaceholder('optional')
          .setValue(source.authToken)
          .onChange(async (value) => {
            source.authToken = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Source actions')
      .setDesc('Test fallback reachability, install/update this source, or remove it.')
      .addButton((button) =>
        button.setButtonText('Test').onClick(async () => {
          try {
            const remote = await this.plugin.testSourceConnectivity(source);
            new Notice(`Plugin Loader: ${source.displayName} reachable via ${remote.endpoint}`);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            new Notice(`Plugin Loader: test failed for ${source.displayName} - ${reason}`);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText('Install/Update').setCta().onClick(async () => {
          await this.plugin.installOrUpdateSource(source, true);
        }),
      )
      .addButton((button) =>
        button.setButtonText('Remove').onClick(async () => {
          this.plugin.settings.sources = this.plugin.settings.sources.filter((entry) => entry.id !== source.id);
          await this.plugin.saveSettings();
          this.display();
        }),
      );
  }
}

class ConfirmInstallModal extends Modal {
  private readonly sourceName: string;
  private readonly pluginId: string;
  private readonly localVersion: string;
  private readonly remoteVersion: string;
  private readonly endpoint: string;
  private resolvePromise: ((value: boolean) => void) | null = null;

  static open(
    app: App,
    sourceName: string,
    pluginId: string,
    localVersion: string,
    remoteVersion: string,
    endpoint: string,
  ): Promise<boolean> {
    const modal = new ConfirmInstallModal(
      app,
      sourceName,
      pluginId,
      localVersion,
      remoteVersion,
      endpoint,
    );
    return new Promise<boolean>((resolve) => {
      modal.resolvePromise = resolve;
      modal.open();
    });
  }

  private constructor(
    app: App,
    sourceName: string,
    pluginId: string,
    localVersion: string,
    remoteVersion: string,
    endpoint: string,
  ) {
    super(app);
    this.sourceName = sourceName;
    this.pluginId = pluginId;
    this.localVersion = localVersion;
    this.remoteVersion = remoteVersion;
    this.endpoint = endpoint;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Confirm plugin install/update' });
    this.contentEl.createEl('p', {
      text: `${this.sourceName} (${this.pluginId})`,
    });
    this.contentEl.createEl('p', {
      text: `Current version: ${this.localVersion}`,
    });
    this.contentEl.createEl('p', {
      text: `Remote version: ${this.remoteVersion}`,
    });
    this.contentEl.createEl('p', {
      text: `Selected endpoint: ${this.endpoint}`,
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText('Cancel').onClick(() => {
          this.closeWithValue(false);
        }),
      )
      .addButton((button) =>
        button.setButtonText('Install').setCta().onClick(() => {
          this.closeWithValue(true);
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.resolvePromise) {
      const resolve = this.resolvePromise;
      this.resolvePromise = null;
      resolve(false);
    }
  }

  private closeWithValue(value: boolean): void {
    if (this.resolvePromise) {
      const resolve = this.resolvePromise;
      this.resolvePromise = null;
      resolve(value);
    }
    this.close();
  }
}

function parseManifest(manifestText: string, expectedPluginId: string): PluginManifestLike {
  const parsed = JSON.parse(manifestText) as PluginManifestLike;

  if (!parsed.id) {
    throw new Error('manifest is missing id');
  }

  if (expectedPluginId && parsed.id !== expectedPluginId) {
    throw new Error(`manifest id ${parsed.id} does not match configured plugin id ${expectedPluginId}`);
  }

  return parsed;
}

function joinUrl(baseUrl: string, relativePath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function isSshEndpoint(endpoint: string): boolean {
  return endpoint.startsWith('ssh://');
}

function parseSshEndpoint(endpoint: string): { userHost: string; remoteRootPath: string } | null {
  if (endpoint.startsWith('ssh://')) {
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

async function ensureDirectory(
  adapter: {
    exists: (path: string) => Promise<boolean>;
    mkdir: (path: string) => Promise<void>;
  },
  fullPath: string,
): Promise<void> {
  const parts = fullPath.split('/').filter(Boolean);
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

function compareVersions(left: string, right: string): number {
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

function sanitizeVersion(version: string): number[] {
  return version
    .replace(/^[^\d]*/, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .map((value) => (Number.isFinite(value) ? value : 0));
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
