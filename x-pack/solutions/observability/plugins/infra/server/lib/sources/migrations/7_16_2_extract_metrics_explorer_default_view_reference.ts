/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectMigrationFn } from '@kbn/core/server';
import type { InfraSourceConfiguration } from '../../../../common/source_configuration/source_configuration';
import { extractMetricsExplorerSavedViewReferences } from '../saved_object_references';

export const extractMetricsExplorerDefaultViewReference: SavedObjectMigrationFn<
  InfraSourceConfiguration,
  InfraSourceConfiguration
> = (sourceConfigurationDocument) => {
  const { attributes, references } = extractMetricsExplorerSavedViewReferences(
    sourceConfigurationDocument.attributes
  );

  return {
    ...sourceConfigurationDocument,
    attributes,
    references: [...(sourceConfigurationDocument.references ?? []), ...references],
  };
};
