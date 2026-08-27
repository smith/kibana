/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import {
  DEPLOYMENT_ENVIRONMENT,
  DEPLOYMENT_ENVIRONMENT_NAME,
} from '@kbn/apm-types/es_fields';
import { SERVICE_ENVIRONMENT, SERVICE_NODE_NAME } from '../es_fields/apm';
import { ENVIRONMENT_ALL, ENVIRONMENT_NOT_DEFINED } from '../environment_filter_values';
import { SERVICE_NODE_NAME_MISSING } from '../service_nodes';

// All fields that can carry an environment value. Enriched APM docs use
// service.environment; unprocessed OTel docs carry one of the two OTel fields.
const ENVIRONMENT_FIELDS = [SERVICE_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT_NAME, DEPLOYMENT_ENVIRONMENT];

export function environmentQuery(
  environment: string | undefined,
  field: string = SERVICE_ENVIRONMENT
): QueryDslQueryContainer[] {
  if (environment === ENVIRONMENT_ALL.value) {
    return [];
  }

  if (!environment || environment === ENVIRONMENT_NOT_DEFINED.value) {
    // "Not defined" means none of the environment fields are set (or set to the
    // sentinel value). Match docs where every environment field is absent.
    return [
      {
        bool: {
          should: [
            { term: { [field]: ENVIRONMENT_NOT_DEFINED.value } },
            {
              bool: {
                must_not: ENVIRONMENT_FIELDS.map((f) => ({ exists: { field: f } })),
              },
            },
          ],
          minimum_should_match: 1,
        },
      },
    ];
  }

  // For a specific environment, match any of the three possible carrier fields.
  return [
    {
      bool: {
        should: ENVIRONMENT_FIELDS.map((f) => ({ term: { [f]: environment } })),
        minimum_should_match: 1,
      },
    },
  ];
}

export function serviceNodeNameQuery(serviceNodeName?: string): QueryDslQueryContainer[] {
  if (!serviceNodeName) {
    return [];
  }

  if (serviceNodeName === SERVICE_NODE_NAME_MISSING) {
    return [{ bool: { must_not: [{ exists: { field: SERVICE_NODE_NAME } }] } }];
  }

  return [{ term: { [SERVICE_NODE_NAME]: serviceNodeName } }];
}
