const { DopplerSDK } = require('@dopplerhq/node-sdk');
const { getPassword } = require('keytar');
const prompts = require('prompts');
const { join, resolve } = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

class DopplerSecretsPlugin {
  constructor(serverless) {
    this.serverless = serverless;
    this.getSecretsPromise = null;

    this.configurationVariablesSources = {
      doppler: {
        resolve: this.resolveDopplerSecret.bind(this),
      },
    };

    this.serverless.configSchemaHandler.defineTopLevelProperty('doppler', {
      type: 'object',
      properties: {
        token: { type: 'string' },
        project: { type: 'string' },
        config: { type: 'string' },
        nonInteractive: { type: 'boolean' },
        stages: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              project: { type: 'string' },
              config: { type: 'string' },
              nonInteractive: { type: 'boolean' },
            },
          },
        },
      },
    });

    this.getDopplerSecrets = this.getDopplerSecrets.bind(this);
    this.getLocalDopplerSettings = this.getLocalDopplerSettings.bind(this);
    this.promptProject = this.promptProject.bind(this);
    this.promptConfig = this.promptConfig.bind(this);
    this.parseServerlessCliParams = this.parseServerlessCliParams.bind(this);
  }

  async resolveDopplerSecret({ address, options }) {
    if (!this.getSecretsPromise) {
      const stage = this.serverless.configurationInput.provider.stage;
      const cliDopplerParams = this.parseServerlessCliParams(options.param);
      const slsDopplerConfig = this.serverless.configurationInput.doppler;

      const accessToken =
        cliDopplerParams['doppler-token'] ??
        slsDopplerConfig?.stages?.[stage]?.token ??
        slsDopplerConfig?.token;

      const specifiedProjectId =
        cliDopplerParams['doppler-project'] ??
        slsDopplerConfig?.stages?.[stage]?.project ??
        slsDopplerConfig?.project;

      const specifiedConfigId =
        cliDopplerParams['doppler-config'] ??
        slsDopplerConfig?.stages?.[stage]?.config ??
        slsDopplerConfig?.config;

      let nonInteractive =
        cliDopplerParams['doppler-non-interactive'] ??
        slsDopplerConfig?.stages?.[stage]?.nonInteractive ??
        slsDopplerConfig?.nonInteractive;

      if (nonInteractive === false) {
        nonInteractive = !process.stdin.isTTY;
      }

      this.getSecretsPromise = this.getDopplerSecrets({
        accessToken,
        specifiedProjectId,
        specifiedConfigId,
        interactive: !nonInteractive,
      });
    }

    const secrets = await this.getSecretsPromise;

    if (!secrets[address]) {
      throw new Error(`could not resolve doppler secret "${address}"`);
    }

    return {
      value: secrets[address],
    };
  }

  async getDopplerSecrets({
    accessToken,
    specifiedProjectId,
    specifiedConfigId,
    nonInteractive,
  } = {}) {
    const localSettings = await this.getLocalDopplerSettings();

    accessToken ??= localSettings.accessToken;
    if (!accessToken) {
      throw new Error('missing doppler access token');
    }

    const doppler = new DopplerSDK({ accessToken });

    const projectId = await this.promptProject({
      doppler,
      accessToken,
      specifiedProjectId,
      localProjectId: localSettings.projectId,
      nonInteractive,
    });

    if (!projectId) {
      throw new Error('missing doppler project');
    }

    const configId = await this.promptConfig({
      doppler,
      accessToken,
      projectId,
      specifiedConfigId,
      localConfigId: localSettings.configId,
      nonInteractive,
    });

    if (!configId) {
      throw new Error('missing doppler config');
    }

    const secrets = await doppler.secrets.list(projectId, configId);

    return Object.fromEntries(
      Object.entries(secrets.secrets).map(([key, value]) => [key, value.computed]),
    );
  }

  async promptProject({
    doppler,
    accessToken,
    specifiedProjectId,
    localProjectId,
    nonInteractive,
  }) {
    const getProjectsResponse = await doppler.projects.list({ perPage: 10_000 });

    if (!getProjectsResponse.projects?.length) {
      // no projects available for token
      throw new Error('no available doppler projects');
    }

    if (accessToken.startsWith('dp.st.') && getProjectsResponse.projects.length === 1) {
      // service token provided and there is one project available, automatically use this project
      return getProjectsResponse.projects[0].slug;
    }

    const availableProjects = getProjectsResponse.projects.map(p => p.slug);

    if (specifiedProjectId && availableProjects.includes(specifiedProjectId)) {
      // projectId was specified and it is available, automatically use this project
      return specifiedProjectId;
    }

    // multiple projects available, but projectId isn't specified or it doesn't match available projects
    // must prompt user to select a project

    if (nonInteractive) {
      // non interactive mode, must fail
      throw new Error('project selection required');
    }

    const initialIndex = availableProjects.indexOf(localProjectId);

    const { projectId } = await prompts([
      {
        type: 'select',
        name: 'projectId',
        message: 'Select a Doppler project',
        choices: getProjectsResponse.projects.map(p => ({ title: p.slug, value: p.slug })),
        initial: initialIndex >= 0 ? initialIndex : undefined,
      },
    ]);

    return projectId;
  }

  async promptConfig({
    doppler,
    accessToken,
    projectId,
    specifiedConfigId,
    localConfigId,
    nonInteractive,
  }) {
    const getConfigsResponse = await doppler.configs.list(projectId, { perPage: 10_000 });

    if (!getConfigsResponse.configs?.length) {
      // no configs available for token
      throw new Error('no available doppler configs');
    }

    if (accessToken.startsWith('dp.st.') && getConfigsResponse.configs.length === 1) {
      // service token provided and there is one config available, automatically use this config
      return getConfigsResponse.configs[0].name;
    }

    const availableConfigs = getConfigsResponse.configs.map(p => p.name);

    if (specifiedConfigId && availableConfigs.includes(specifiedConfigId)) {
      // configId was specified and it is available, automatically use this config
      return specifiedConfigId;
    }

    // multiple configs available, but configId isn't specified or it doesn't match available configs
    // must prompt user to select a config

    if (nonInteractive) {
      // non interactive mode, must fail
      throw new Error('config selection required');
    }

    const initialIndex = availableConfigs.indexOf(localConfigId);

    const { configId } = await prompts([
      {
        type: 'select',
        name: 'configId',
        message: 'Select a Doppler config',
        choices: getConfigsResponse.configs.map(c => ({ title: c.name, value: c.name })),
        initial: initialIndex >= 0 ? initialIndex : undefined,
      },
    ]);

    return configId;
  }

  async getLocalDopplerSettings() {
    const dopplerConfigPath = join(os.homedir(), '.doppler', '.doppler.yaml');

    if (!fs.existsSync(dopplerConfigPath)) {
      return {};
    }

    const dopplerConfig = await this.serverless.yamlParser.parse(dopplerConfigPath);

    const keychainAccount = getScopedValue(
      dopplerConfig.scoped,
      this.serverless.serviceDir,
      c => c?.token,
    );
    const projectId = getScopedValue(
      dopplerConfig.scoped,
      this.serverless.serviceDir,
      c => c?.['enclave.project'],
    );
    const configId = getScopedValue(
      dopplerConfig.scoped,
      this.serverless.serviceDir,
      c => c?.['enclave.config'],
    );

    let accessToken = undefined;

    if (keychainAccount) {
      let encodedToken = await getPassword('doppler-cli', keychainAccount);
      encodedToken = encodedToken?.replace('go-keyring-encoded:', '');
      if (encodedToken) {
        accessToken = Buffer.from(encodedToken, 'hex').toString('utf8');
      }
    }

    return {
      accessToken,
      projectId: projectId || undefined,
      configId: configId || undefined,
    };

    function getScopedValue(scopes, path, selector) {
      while (true) {
        const scope = scopes[path];
        const value = selector(scope);

        if (value) return value;

        if (path === '/') return null;

        path = resolve(path, '..');
      }
    }
  }

  parseServerlessCliParams(params) {
    return Object.fromEntries(
      params
        ?.filter(s => s.startsWith('doppler-'))
        ?.map(p => p.split('='))
        ?.map(s => [s[0], s[1]])
        ?.map(p => {
          // parse boolean values
          if (p[1] === 'true' || p[1] === 'false' || p[1] === undefined) {
            const isTrue = p[1] === 'true' || p[1] === undefined;
            return [p[0], isTrue];
          }
          return p;
        }) || [],
    );
  }
}

module.exports = DopplerSecretsPlugin;
