/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { SyntheticsEsClient } from '../lib';
import { asMutableArray } from '../../common/utils/as_mutable_array';
import { JourneyStep } from '../../common/runtime_types/ping/synthetics';

export interface GetJourneyStepsParams {
  checkGroups: string[];
}

export const getJourneyFailedSteps = async ({
  syntheticsEsClient,
  checkGroups,
}: GetJourneyStepsParams & {
  syntheticsEsClient: SyntheticsEsClient;
}): Promise<JourneyStep[]> => {
  const params = {
    query: {
      bool: {
        filter: [
          {
            terms: {
              'synthetics.type': ['step/end'],
            },
          },
          {
            exists: {
              field: 'synthetics.error',
            },
          },
          {
            terms: {
              'monitor.check_group': checkGroups,
            },
          },
        ] as QueryDslQueryContainer[],
      },
    },
    sort: asMutableArray([
      { 'synthetics.step.index': { order: 'asc' } },
      { '@timestamp': { order: 'asc' } },
    ] as const),
    _source: {
      excludes: ['synthetics.blob'],
    },
    size: 500,
  };

  const { body: result } = await syntheticsEsClient.search(params);

  return result.hits.hits.map(({ _id, _source }) => {
    const step = Object.assign({ _id }, _source) as JourneyStep;
    return {
      ...step,
      timestamp: step['@timestamp'],
    };
  });
};
