/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kqlQuery, rangeQuery, wildcardQuery } from '@kbn/observability-plugin/server';
import {
  calculateThroughputWithRange,
  calculateFailedTransactionRate,
  getOutcomeAggregation,
  getDurationFieldForTransactions,
} from '@kbn/apm-data-access-plugin/server/utils';
import type { ApmTransactionDocumentType } from '../../../common/document_type';
import {
  KIND,
  PROCESSOR_EVENT,
  SERVICE_NAME,
  SPAN_NAME,
  TRANSACTION_NAME,
  TRANSACTION_OVERFLOW_COUNT,
  TRANSACTION_TYPE,
} from '../../../common/es_fields/apm';
import type { LatencyAggregationType } from '../../../common/latency_aggregation_types';
import type { RollupInterval } from '../../../common/rollup';
import { environmentQuery } from '../../../common/utils/environment_query';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { getLatencyAggregation, getLatencyValue } from '../../lib/helpers/latency_aggregation_type';

const txGroupsDroppedBucketName = '_other';
export const MAX_NUMBER_OF_TX_GROUPS = 1_000;

// Runtime field that coalesces transaction.name (APM) and span.name (OTel).
// Unprocessed OTel spans lack transaction.name; span.name is their equivalent.
const EFFECTIVE_NAME_FIELD = 'effective_name';
const effectiveNameRuntimeMapping = {
  [EFFECTIVE_NAME_FIELD]: {
    type: 'keyword' as const,
    script: {
      source: `
        if (doc.containsKey('${TRANSACTION_NAME}') && doc['${TRANSACTION_NAME}'].size() > 0) {
          emit(doc['${TRANSACTION_NAME}'].value);
        } else if (doc.containsKey('${SPAN_NAME}') && doc['${SPAN_NAME}'].size() > 0) {
          emit(doc['${SPAN_NAME}'].value);
        }
      `,
    },
  },
};

interface TransactionGroups {
  alertsCount: number;
  name: string;
  transactionType: string;
  latency: number | null;
  throughput: number;
  errorRate: number;
  impact: number;
}

export interface ServiceTransactionGroupsResponse {
  transactionGroups: TransactionGroups[];
  maxCountExceeded: boolean;
  transactionOverflowCount: number;
  hasActiveAlerts: boolean;
}

export async function getServiceTransactionGroups({
  environment,
  kuery,
  serviceName,
  apmEventClient,
  transactionType,
  latencyAggregationType,
  start,
  end,
  documentType,
  rollupInterval,
  useDurationSummary,
  searchQuery,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  apmEventClient: APMEventClient;
  transactionType: string;
  latencyAggregationType: LatencyAggregationType;
  start: number;
  end: number;
  documentType: ApmTransactionDocumentType;
  rollupInterval: RollupInterval;
  useDurationSummary: boolean;
  searchQuery?: string;
}): Promise<ServiceTransactionGroupsResponse> {
  const field = getDurationFieldForTransactions(documentType, useDurationSummary);

  const response = await apmEventClient.search('get_service_transaction_groups', {
    apm: {
      sources: [
        {
          documentType,
          rollupInterval,
        },
      ],
    },
    track_total_hits: false,
    size: 0,
    runtime_mappings: effectiveNameRuntimeMapping,
    query: {
      bool: {
        filter: [
          { term: { [SERVICE_NAME]: serviceName } },
          {
            bool: {
              // Match enriched APM docs by transaction.type, the overflow bucket
              // name, or OTel entry spans (Server/Consumer kind, no
              // processor.event). Server/Consumer spans may have a parent in
              // distributed traces — kind is the right discriminator.
              should: [
                { term: { [TRANSACTION_NAME]: txGroupsDroppedBucketName } },
                { term: { [TRANSACTION_TYPE]: transactionType } },
                {
                  bool: {
                    must: [{ terms: { [KIND]: ['Server', 'Consumer'] } }],
                    must_not: [{ exists: { field: PROCESSOR_EVENT } }],
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
          ...rangeQuery(start, end),
          ...environmentQuery(environment),
          ...kqlQuery(kuery),
          ...wildcardQuery(EFFECTIVE_NAME_FIELD, searchQuery),
        ],
      },
    },
    aggs: {
      total_duration: { sum: { field } },
      transaction_overflow_count: {
        sum: {
          field: TRANSACTION_OVERFLOW_COUNT,
        },
      },
      transaction_groups: {
        terms: {
          field: EFFECTIVE_NAME_FIELD,
          size: MAX_NUMBER_OF_TX_GROUPS,
          order: { _count: 'desc' },
        },
        aggs: {
          transaction_group_total_duration: {
            sum: { field },
          },
          ...getLatencyAggregation(latencyAggregationType, field),
          ...getOutcomeAggregation(documentType),
        },
      },
    },
  });

  const totalDuration = response.aggregations?.total_duration.value;

  const transactionGroups =
    response.aggregations?.transaction_groups.buckets.map((bucket) => {
      const errorRate = calculateFailedTransactionRate(bucket);

      const transactionGroupTotalDuration = bucket.transaction_group_total_duration.value || 0;

      return {
        name: bucket.key as string,
        latency: getLatencyValue({
          latencyAggregationType,
          aggregation: bucket.latency,
        }),
        throughput: calculateThroughputWithRange({
          start,
          end,
          value: bucket.doc_count,
        }),
        errorRate,
        impact: totalDuration ? (transactionGroupTotalDuration * 100) / totalDuration : 0,
        alertsCount: 0,
      };
    }) ?? [];

  return {
    transactionGroups: transactionGroups.map((transactionGroup) => ({
      ...transactionGroup,
      transactionType,
    })),
    maxCountExceeded: (response.aggregations?.transaction_groups.sum_other_doc_count ?? 0) > 0,
    transactionOverflowCount: response.aggregations?.transaction_overflow_count.value ?? 0,
    hasActiveAlerts: false,
  };
}
