/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export type { HomeServerPluginSetup, HomeServerPluginStart } from './plugin';
export { EmbeddableTypes, TutorialsCategory } from './services';
export type {
  AppLinkData,
  ArtifactsSchema,
  TutorialProvider,
  TutorialSchema,
  StatusCheckSchema,
  Instruction,
  InstructionVariant,
  InstructionSetSchema,
  InstructionsSchema,
  TutorialContext,
  SampleDatasetProvider,
  SampleDataRegistrySetup,
  SampleDatasetDashboardPanel,
  SampleObject,
  ScopedTutorialContextFactory,
} from './services';
import { PluginInitializerContext, PluginConfigDescriptor } from '@kbn/core/server';
import { configSchema, ConfigSchema } from './config';

export const config: PluginConfigDescriptor<ConfigSchema> = {
  exposeToBrowser: {
    disableWelcomeScreen: true,
  },
  schema: configSchema,
};

export const plugin = async (initContext: PluginInitializerContext) => {
  const { HomeServerPlugin } = await import('./plugin');
  return new HomeServerPlugin(initContext);
};

export { INSTRUCTION_VARIANT } from '../common/instruction_variant';
