# serverless-doppler-secrets

Serverless plugin that adds custom `doppler:` variable source.

* [Quick Start](#quick-start)
* [Parameters](#parameters)
* [Usage](#usage)
  * [CLI Params](#cli-params)
  * [Per Stage](#per-stage)
  * [Service Wide](#service-wide)
* [Common Usage](#common-usage)


## Quick Start

```bash
npm install -D serverless-doppler-secrets
```

Common usage - single doppler project, individual doppler config per stage:

```yaml
service: example-service

provider:
  # ...
  environment:
    APP_ID: ${doppler:APP_ID}
    LOG_LEVEL: ${doppler:LOG_LEVEL}
  
doppler:
  localFallback: true # fallback to local Doppler CLI settings (cli access token from keychain)
  project: doppler-project-id
  stages:
    dev:
      config: dev_config_slug
    production:
      config: prd_config_slug

plugins:
  - serverless-doppler-secrets
```

To deploy:

```bash
serverless deploy # uses local Doppler CLI access token from keychain

# -- OR --

serverless deploy --param "doppler-token=dp.sa.abc123" # service account token

# -- OR --

serverless deploy --param "doppler-token=dp.st.dev_config_slug.abc123" # service token, overrides project and config values
```

## Parameters

* `token` - string. Doppler access token. This can be any Doppler access token (CLI Token, Service Account Token, Service Token etc.). The token must have access to the project and config. If a [Service Token](https://docs.doppler.com/docs/service-tokens) is provided, the project and config values will be ignored (A service token is specific to a single project+config).
  * `doppler-token` on CLI 
* `project` - string. Doppler project ID
  * `doppler-project` on CLI
* `config` - string. Doppler config slug
  * `doppler-config` on CLI
* `localFallback` - boolean (default false). If true, plugin will attempt to resolve any missing values from the user's local Doppler settings (`~/.doppler/.doppler.yaml`). To use local CLI Access Token, `doppler login` must be run first. To use local Doppler project or config, `doppler setup` must be run first. This will not work in a CICD or automated context.


## Usage

Doppler `token`, `project`, and `config` values can be defined as CLI params, per-stage, or service-wide. The values will be resolved in this order:
1. CLI params
2. per-stage params
3. service-wide params

### CLI Params

CLI params will take precedence over service-wide and per-stage values.

```bash
serverless deploy \
  --param "doppler-token=dp.sa.abc123" \
  --param "doppler-project=project-id" \
  --param "doppler-config=config_slug"
```

### Per Stage

Define token, project, and config per stage. These will take precedence over service-wide values.

```yaml
doppler:
  stages:
    dev:
      token: dp.sa.abc123
      project: doppler-project-id
      config: dev_doppler_config_slug
    production:
      token: dp.sa.abc123
      project: doppler-project-id
      config: prd_doppler_config_slug
```

### Service Wide

Define token, project, and config for the entire project.

```yaml
doppler:
  token: dp.sa.abc123
  project: doppler-project-id
  config: doppler_config_slug
```

## Common Usage

### 