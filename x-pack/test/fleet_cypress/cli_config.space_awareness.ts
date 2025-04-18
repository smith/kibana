/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrConfigProviderContext } from '@kbn/test';

import { FleetCypressCliTestRunner } from './runner';

export default async function ({ readConfigFile }: FtrConfigProviderContext) {
  const cypressConfig = await readConfigFile(require.resolve('./config.space_awareness.ts'));
  return {
    ...cypressConfig.getAll(),

    testRunner: FleetCypressCliTestRunner,
  };
}
