const { DopplerSDK } = require('@dopplerhq/node-sdk');
const { getPassword } = require('keytar');
const { parse: parseYaml } = require('yaml');
const debug = require('debug')('serverless-doppler-secrets');
const { join, resolve } = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

class DopplerSecretsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.getDopplerSecretsPromise = null;

    this.getDopplerSecrets = this.getDopplerSecrets.bind(this);
    this.getAvailableProjectIds = this.getAvailableProjectIds.bind(this);
    this.getAvailableConfigIds = this.getAvailableConfigIds.bind(this);
    this.getLocalDopplerSettings = this.getLocalDopplerSettings.bind(this);

    this.configurationVariablesSources = {
      doppler: {
        resolve: this.resolveDopplerSecret.bind(this),
      },
    };

    serverless.configSchemaHandler.defineTopLevelProperty('doppler', {
      type: 'object',
      properties: {
        token: { type: 'string' },
        project: { type: 'string' },
        config: { type: 'string' },
        stages: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              project: { type: 'string' },
              config: { type: 'string' },
            },
          },
        },
      },
    });
  }

  async resolveDopplerSecret({ address, options }) {
    if (!this.getDopplerSecretsPromise) {
      const cliParams = Object.fromEntries(
        options.param
          ?.filter(p => p?.startsWith('doppler-'))
          ?.map(p => p.split('='))
          ?.map(s => [s[0], s[1]]) || [],
      );

      const stage = this.serverless.configurationInput.provider.stage;

      const accessToken =
        cliParams['doppler-token'] ??
        this.serverless.configurationInput.doppler?.stages?.[stage]?.token ??
        this.serverless.configurationInput.doppler?.token;

      const projectId =
        cliParams['doppler-project'] ??
        this.serverless.configurationInput.doppler?.stages?.[stage]?.project ??
        this.serverless.configurationInput.doppler?.project;

      const configId =
        cliParams['doppler-config'] ??
        this.serverless.configurationInput.doppler?.stages?.[stage]?.config ??
        this.serverless.configurationInput.doppler?.config;

      debug('Resolving Doppler secrets');
      debug('stage: %s', stage);
      debug('accessToken: %s', accessToken);
      debug('projectId: %s', projectId);
      debug('configId: %s"', configId);

      this.getDopplerSecretsPromise = this.getDopplerSecrets(accessToken, projectId, configId);
    }

    const secrets = await this.getDopplerSecretsPromise;

    if (!secrets[address]) {
      throw new Error(`could not resolve doppler secret "${address}"`);
    }

    return {
      value: secrets[address],
    };
  }

  async getDopplerSecrets(accessToken, projectId, configId) {
    if (!accessToken) {
      debug('No Doppler access token provided, attempting to use local CLI Doppler settings');

      const localSettings = await this.getLocalDopplerSettings();

      if (!localSettings?.accessToken) {
        throw new Error(
          'no doppler access token provided and local doppler cli not configured for project',
        );
      }

      accessToken = localSettings.accessToken;
    }

    const doppler = new DopplerSDK({ accessToken });

    const me = await doppler.auth.me();

    if (me.type_ === 'service_token') {
      const [pid, ...otherPids] = await this.getAvailableProjectIds(doppler);
      if (!pid) {
        throw new Error('cannot find doppler project associated with service token');
      }
      if (otherPids?.length) {
        throw new Error('multiple doppler projects associated with service token');
      }

      const [cid, ...otherCids] = await this.getAvailableConfigIds(doppler, pid);
      if (!cid) {
        throw new Error('cannot find doppler config associated with service token');
      }
      if (otherCids?.length) {
        throw new Error('multiple doppler configs associated with service token');
      }

      if (projectId && projectId !== pid) {
        throw new Error('service token corresponds to a different doppler project than specified');
      }
      if (configId && configId !== cid) {
        throw new Error('service token corresponds to a different doppler config than specified');
      }

      projectId = pid;
      configId = cid;
    }

    if (!projectId) {
      throw new Error('missing doppler project');
    }

    if (!configId) {
      throw new Error('missing doppler config');
    }

    const secrets = await doppler.secrets.list(projectId, configId);

    return Object.fromEntries(
      Object.entries(secrets.secrets).map(([key, value]) => [key, value.computed]),
    );
  }

  async getAvailableProjectIds(doppler) {
    const projects = await doppler.projects.list();

    return projects.projects?.map(p => p.slug) || [];
  }

  async getAvailableConfigIds(doppler, projectId) {
    const configs = await doppler.configs.list(projectId);

    return configs.configs?.map(c => c.name) || [];
  }

  async getLocalDopplerSettings() {
    const dopplerConfigPath = join(os.homedir(), '.doppler', '.doppler.yaml');

    if (!fs.existsSync(dopplerConfigPath)) {
      throw new Error(`no local doppler config. (no file at "${dopplerConfigPath}")`);
    }

    const dopplerConfig = parseYaml(fs.readFileSync(dopplerConfigPath).toString());

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

    let encodedToken = await getPassword('doppler-cli', keychainAccount);
    encodedToken = encodedToken.replace('go-keyring-encoded:', '');

    const accessToken = Buffer.from(encodedToken, 'hex').toString('utf8');

    return { accessToken, projectId, configId };

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
}

module.exports = DopplerSecretsPlugin;
