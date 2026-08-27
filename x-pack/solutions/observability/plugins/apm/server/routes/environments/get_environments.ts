/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rangeQuery, termQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { uniq } from 'lodash';
import { DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT_NAME } from '@kbn/apm-types/es_fields';
import { SERVICE_ENVIRONMENT, SERVICE_NAME } from '../../../common/es_fields/apm';
import { ENVIRONMENT_NOT_DEFINED } from '../../../common/environment_filter_values';
import type { Environment } from '../../../common/environment_rt';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { getSuggestionsWithTermsAggregation } from '../suggestions/get_suggestions_with_terms_aggregation';
import { getProcessorEventForTransactions } from '../../lib/helpers/transactions';

/**
 * This is used for getting the list of environments for the environment selector,
 * filtered by range.
 */
export async function getEnvironments({
  searchAggregatedTransactions,
  serviceName,
  apmEventClient,
  size,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  serviceName?: string;
  searchAggregatedTransactions: boolean;
  size: number;
  start: number;
  end: number;
}): Promise<Environment[]> {
  const [hasUnsetEnvironments, resp, otelResp] = await Promise.all([
    // A doc is "Not defined" only when it has none of the three env fields.
    // OTel spans lack service.environment but have deployment.environment.name,
    // so we must exclude those from the "unset" count.
    apmEventClient
      .search('has_unset_environment', {
        apm: {
          events: [
            getProcessorEventForTransactions(searchAggregatedTransactions),
            ProcessorEvent.metric,
            ProcessorEvent.error,
          ],
        },
        track_total_hits: true,
        terminate_after: 1,
        size: 0,
        query: {
          bool: {
            filter: [...termQuery(SERVICE_NAME, serviceName), ...rangeQuery(start, end)],
            must_not: [
              { exists: { field: SERVICE_ENVIRONMENT } },
              { exists: { field: DEPLOYMENT_ENVIRONMENT_NAME } },
              { exists: { field: DEPLOYMENT_ENVIRONMENT } },
            ],
          },
        },
      })
      .then((r) => (r.hits.total as { value: number })?.value > 0),
    getSuggestionsWithTermsAggregation({
      fieldName: SERVICE_ENVIRONMENT,
      fieldValue: '',
      searchAggregatedTransactions,
      serviceName,
      apmEventClient,
      size,
      start,
      end,
    }),
    // OTel spans use deployment.environment.name (and legacy deployment.environment)
    // instead of service.environment. Aggregate them separately and merge.
    apmEventClient.search('get_environments_otel', {
      apm: {
        events: [
          getProcessorEventForTransactions(searchAggregatedTransactions),
          ProcessorEvent.error,
          ProcessorEvent.metric,
        ],
      },
      track_total_hits: false,
      size: 0,
      query: {
        bool: {
          filter: [...termQuery(SERVICE_NAME, serviceName), ...rangeQuery(start, end)],
        },
      },
      aggs: {
        otel_environments: {
          terms: { field: DEPLOYMENT_ENVIRONMENT_NAME, size },
        },
        otel_environments_legacy: {
          terms: { field: DEPLOYMENT_ENVIRONMENT, size },
        },
      },
    }),
  ]);

  const environments = uniq([
    ...resp.terms,
    ...(otelResp.aggregations?.otel_environments.buckets.map((b) => b.key as string) ?? []),
    ...(otelResp.aggregations?.otel_environments_legacy.buckets.map((b) => b.key as string) ?? []),
  ]);

  // Show "Not defined" only when APM docs lack service.environment AND no OTel
  // environment fields cover those docs either.
  if (hasUnsetEnvironments) {
    environments.push(ENVIRONMENT_NOT_DEFINED.value);
  }

  return environments as Environment[];
}
