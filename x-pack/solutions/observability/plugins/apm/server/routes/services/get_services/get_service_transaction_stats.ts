/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kqlQuery, rangeQuery, wildcardQuery } from '@kbn/observability-plugin/server';
import { getAgentName } from '@kbn/elastic-agent-utils';
import {
  calculateThroughputWithRange,
  calculateFailedTransactionRate,
  getOutcomeAggregation,
  getDurationFieldForTransactions,
} from '@kbn/apm-data-access-plugin/server/utils';
import type { ApmDocumentType } from '../../../../common/document_type';
import { DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT_NAME, DURATION } from '@kbn/apm-types/es_fields';
import {
  AGENT_NAME,
  SERVICE_ENVIRONMENT,
  SERVICE_NAME,
  TRANSACTION_TYPE,
  SERVICE_OVERFLOW_COUNT,
  TELEMETRY_SDK_NAME,
  TELEMETRY_SDK_LANGUAGE,
} from '../../../../common/es_fields/apm';
import type { RollupInterval } from '../../../../common/rollup';
import type { ServiceGroup } from '../../../../common/service_groups';
import { isDefaultTransactionType } from '../../../../common/transaction_types';
import { environmentQuery } from '../../../../common/utils/environment_query';
import type { AgentName } from '../../../../typings/es_schemas/ui/fields/agent';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import type { RandomSampler } from '../../../lib/helpers/get_random_sampler';
import { maybe } from '../../../../common/utils/maybe';
import { serviceGroupWithOverflowQuery } from '../../../lib/service_group_query_with_overflow';

interface AggregationParams {
  environment: string;
  kuery: string;
  apmEventClient: APMEventClient;
  maxNumServices: number;
  start: number;
  end: number;
  serviceGroup: ServiceGroup | null;
  randomSampler: RandomSampler;
  documentType:
    | ApmDocumentType.ServiceTransactionMetric
    | ApmDocumentType.TransactionMetric
    | ApmDocumentType.TransactionEvent;
  rollupInterval: RollupInterval;
  useDurationSummary: boolean;
  searchQuery: string | undefined;
}

export interface ServiceTransactionStatsResponse {
  serviceStats: Array<{
    serviceName: string;
    transactionType?: string;
    environments: string[];
    agentName?: AgentName;
    latency?: number | null;
    transactionErrorRate?: number;
    throughput?: number;
  }>;
  maxCountExceeded: boolean;
  serviceOverflowCount: number;
}

export async function getServiceTransactionStats({
  environment,
  kuery,
  apmEventClient,
  maxNumServices,
  start,
  end,
  serviceGroup,
  randomSampler,
  documentType,
  rollupInterval,
  useDurationSummary,
  searchQuery,
}: AggregationParams): Promise<ServiceTransactionStatsResponse> {
  // Synthetic bucket key used by the terms `missing` option to capture OTel
  // root spans that have no transaction.type field.
  const OTEL_NO_TX_TYPE = '__otel__';

  const outcomes = getOutcomeAggregation(documentType);

  const metrics = {
    avg_duration: {
      avg: {
        field: getDurationFieldForTransactions(documentType, useDurationSummary),
      },
    },
    // OTel spans store duration in nanoseconds in `duration`. Absent for APM docs.
    avg_otel_duration: { avg: { field: DURATION } },
    ...outcomes,
  };

  const response = await apmEventClient.search(
    'get_service_transaction_stats',
    {
      apm: {
        sources: [{ documentType, rollupInterval }],
      },
      track_total_hits: false,
      size: 0,
      query: {
        bool: {
          filter: [
            ...rangeQuery(start, end),
            ...environmentQuery(environment),
            ...kqlQuery(kuery),
            ...serviceGroupWithOverflowQuery(serviceGroup),
            ...wildcardQuery(SERVICE_NAME, searchQuery),
          ],
        },
      },
      aggs: {
        sample: {
          random_sampler: randomSampler,
          aggs: {
            overflowCount: {
              sum: { field: SERVICE_OVERFLOW_COUNT },
            },
            services: {
              terms: { field: SERVICE_NAME, size: maxNumServices },
              aggs: {
                telemetryAgentName: { terms: { field: TELEMETRY_SDK_LANGUAGE } },
                telemetrySdkName: { terms: { field: TELEMETRY_SDK_NAME } },
                transactionType: {
                  terms: {
                    field: TRANSACTION_TYPE,
                    // Docs with no transaction.type (unprocessed OTel spans) land
                    // in this synthetic bucket so their metrics are still computed.
                    missing: OTEL_NO_TX_TYPE,
                  },
                  aggs: {
                    ...metrics,
                    environments: { terms: { field: SERVICE_ENVIRONMENT } },
                    otel_environments: { terms: { field: DEPLOYMENT_ENVIRONMENT_NAME } },
                    otel_environments_legacy: { terms: { field: DEPLOYMENT_ENVIRONMENT } },
                    sample: {
                      top_metrics: {
                        metrics: [{ field: AGENT_NAME } as const],
                        sort: { '@timestamp': 'desc' as const },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
  );

  const maxCountExceeded = (response.aggregations?.sample.services.sum_other_doc_count ?? 0) > 0;

  return {
    serviceStats:
      response.aggregations?.sample.services.buckets.map((bucket) => {
        const topTransactionTypeBucket = maybe(
          bucket.transactionType.buckets.find(({ key }) =>
            isDefaultTransactionType(key as string)
          ) ?? bucket.transactionType.buckets[0]
        );

        const txKey = topTransactionTypeBucket?.key as string | undefined;
        // Don't surface the synthetic OTel sentinel as a real transaction type
        const transactionType = txKey === OTEL_NO_TX_TYPE ? undefined : txKey;

        // OTel spans store duration in nanoseconds; convert to microseconds as fallback
        const otelDurationUs =
          topTransactionTypeBucket?.avg_otel_duration?.value != null
            ? topTransactionTypeBucket.avg_otel_duration.value / 1000
            : null;

        return {
          serviceName: bucket.key as string,
          transactionType,
          environments: [
            ...(topTransactionTypeBucket?.environments.buckets.map((b) => b.key as string) ?? []),
            ...(topTransactionTypeBucket?.otel_environments?.buckets.map(
              (b) => b.key as string
            ) ?? []),
            ...(topTransactionTypeBucket?.otel_environments_legacy?.buckets.map(
              (b) => b.key as string
            ) ?? []),
          ],
          agentName: getAgentName(
            topTransactionTypeBucket?.sample.top[0].metrics[AGENT_NAME] as string | null,
            bucket.telemetryAgentName.buckets[0]?.key as string | null,
            bucket.telemetrySdkName.buckets[0]?.key as string | null
          ) as AgentName,
          latency: topTransactionTypeBucket?.avg_duration.value ?? otelDurationUs,
          transactionErrorRate: topTransactionTypeBucket
            ? calculateFailedTransactionRate(topTransactionTypeBucket)
            : undefined,
          throughput: topTransactionTypeBucket
            ? calculateThroughputWithRange({
                start,
                end,
                value: topTransactionTypeBucket.doc_count,
              })
            : undefined,
        };
      }) ?? [],
    maxCountExceeded,
    serviceOverflowCount: response.aggregations?.sample?.overflowCount?.value || 0,
  };
}
