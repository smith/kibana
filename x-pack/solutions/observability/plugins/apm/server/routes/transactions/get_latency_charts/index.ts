/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { BoolQuery } from '@kbn/es-query';
import { kqlQuery, rangeQuery, termQuery } from '@kbn/observability-plugin/server';
import { getDurationFieldForTransactions } from '@kbn/apm-data-access-plugin/server/utils';
import type { TransactionLatencyResponse } from '@kbn/apm-api-shared';
import { DURATION } from '@kbn/apm-types/es_fields';
import type { ApmServiceTransactionDocumentType } from '../../../../common/document_type';
import {
  FAAS_ID,
  KIND,
  PROCESSOR_EVENT,
  SERVICE_NAME,
  TRANSACTION_NAME,
  TRANSACTION_TYPE,
} from '../../../../common/es_fields/apm';
import type { LatencyAggregationType } from '../../../../common/latency_aggregation_types';
import type { RollupInterval } from '../../../../common/rollup';
import { environmentQuery } from '../../../../common/utils/environment_query';
import { getOffsetInMs } from '../../../../common/utils/get_offset_in_ms';
import { nullifyEmptyRedMetricPoints } from '../../../../common/utils/red_metric_value_for_histogram_bucket';
import { offsetPreviousPeriodCoordinates } from '../../../../common/utils/offset_previous_period_coordinate';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import {
  getLatencyAggregation,
  getLatencyValue,
} from '../../../lib/helpers/latency_aggregation_type';

function searchLatency({
  environment,
  kuery,
  filters,
  serviceName,
  transactionType,
  transactionName,
  apmEventClient,
  latencyAggregationType,
  start,
  end,
  offset,
  serverlessId,
  documentType,
  rollupInterval,
  bucketSizeInSeconds,
  useDurationSummary,
}: {
  environment: string;
  kuery: string;
  filters?: BoolQuery;
  serviceName: string;
  transactionType: string | undefined;
  transactionName: string | undefined;
  apmEventClient: APMEventClient;
  latencyAggregationType: LatencyAggregationType;
  start: number;
  end: number;
  offset?: string;
  serverlessId?: string;
  documentType: ApmServiceTransactionDocumentType;
  rollupInterval: RollupInterval;
  bucketSizeInSeconds: number;
  useDurationSummary?: boolean;
}) {
  const { startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  const transactionDurationField = getDurationFieldForTransactions(
    documentType,
    useDurationSummary
  );

  // When a transactionType is specified, match either APM docs by transaction.type
  // or OTel entry spans (Server/Consumer kind, no processor.event) that lack
  // transaction.type entirely.
  const transactionTypeFilter = transactionType
    ? [
        {
          bool: {
            should: [
              { term: { [TRANSACTION_TYPE]: transactionType } },
              {
                bool: {
                  must: [{ terms: { [KIND]: ['Server', 'Consumer'] } }],
                  must_not: [{ exists: { field: PROCESSOR_EVENT } }],
                },
              },
            ],
            minimum_should_match: 1 as const,
          },
        },
      ]
    : [];

  const params = {
    apm: {
      sources: [{ documentType, rollupInterval }],
    },
    track_total_hits: false,
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { [SERVICE_NAME]: serviceName } },
          ...rangeQuery(startWithOffset, endWithOffset),
          ...environmentQuery(environment),
          ...kqlQuery(kuery),
          ...termQuery(TRANSACTION_NAME, transactionName),
          ...transactionTypeFilter,
          ...termQuery(FAAS_ID, serverlessId),
          ...(filters?.filter || []),
        ],
        must_not: filters?.must_not || [],
      },
    },
    aggs: {
      latencyTimeseries: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: `${bucketSizeInSeconds}s`,
          min_doc_count: 0,
          extended_bounds: { min: startWithOffset, max: endWithOffset },
        },
        aggs: {
          ...getLatencyAggregation(latencyAggregationType, transactionDurationField),
          // OTel spans store duration in nanoseconds in `duration`. Used as fallback
          // when transaction.duration.us is absent.
          otel_latency: { avg: { field: DURATION } },
        },
      },
      overall_avg_duration: { avg: { field: transactionDurationField } },
      overall_avg_otel_duration: { avg: { field: DURATION } },
    },
  };

  return apmEventClient.search('get_latency_charts', params);
}

export async function getLatencyTimeseries({
  environment,
  kuery,
  filters,
  serviceName,
  transactionType,
  transactionName,
  apmEventClient,
  latencyAggregationType,
  start,
  end,
  offset,
  serverlessId,
  documentType,
  rollupInterval,
  bucketSizeInSeconds,
  useDurationSummary,
}: {
  environment: string;
  kuery: string;
  filters?: BoolQuery;
  serviceName: string;
  transactionType?: string;
  transactionName?: string;
  apmEventClient: APMEventClient;
  latencyAggregationType: LatencyAggregationType;
  start: number;
  end: number;
  offset?: string;
  serverlessId?: string;
  documentType: ApmServiceTransactionDocumentType;
  rollupInterval: RollupInterval;
  bucketSizeInSeconds: number;
  useDurationSummary?: boolean; // TODO: Make this field mandatory before migrating this for other charts like serverless latency chart, latency history chart
}) {
  const response = await searchLatency({
    environment,
    kuery,
    filters,
    serviceName,
    transactionType,
    transactionName,
    apmEventClient,
    latencyAggregationType,
    start,
    end,
    offset,
    serverlessId,
    documentType,
    rollupInterval,
    bucketSizeInSeconds,
    useDurationSummary,
  });

  if (!response.aggregations) {
    return { latencyTimeseries: [], overallAvgDuration: null };
  }

  const overallAvgDuration =
    response.aggregations.overall_avg_duration.value ||
    (response.aggregations.overall_avg_otel_duration.value != null
      ? response.aggregations.overall_avg_otel_duration.value / 1000
      : null);

  return {
    overallAvgDuration,
    latencyTimeseries: nullifyEmptyRedMetricPoints(
      response.aggregations.latencyTimeseries.buckets.map((bucket) => {
        const apmY = getLatencyValue({
          latencyAggregationType,
          aggregation: bucket.latency,
        });
        // Fall back to OTel duration (ns→µs) when the APM field is absent.
        const otelY =
          bucket.otel_latency?.value != null ? bucket.otel_latency.value / 1000 : null;
        return {
          x: bucket.key,
          docCount: bucket.doc_count,
          y: apmY ?? otelY,
        };
      })
    ),
  };
}

export async function getLatencyPeriods({
  serviceName,
  transactionType,
  transactionName,
  apmEventClient,
  latencyAggregationType,
  kuery,
  filters,
  environment,
  start,
  end,
  offset,
  documentType,
  rollupInterval,
  bucketSizeInSeconds,
  useDurationSummary,
}: {
  serviceName: string;
  transactionType: string | undefined;
  transactionName: string | undefined;
  apmEventClient: APMEventClient;
  latencyAggregationType: LatencyAggregationType;
  kuery: string;
  filters?: BoolQuery;
  environment: string;
  start: number;
  end: number;
  offset?: string;
  documentType: ApmServiceTransactionDocumentType;
  rollupInterval: RollupInterval;
  bucketSizeInSeconds: number;
  useDurationSummary?: boolean;
}): Promise<TransactionLatencyResponse> {
  const options = {
    serviceName,
    transactionType,
    transactionName,
    apmEventClient,
    kuery,
    filters,
    environment,
    documentType,
    rollupInterval,
    bucketSizeInSeconds,
    useDurationSummary,
  };

  const currentPeriodPromise = getLatencyTimeseries({
    ...options,
    start,
    end,
    latencyAggregationType,
  });

  const previousPeriodPromise = offset
    ? getLatencyTimeseries({
        ...options,
        start,
        end,
        offset,
        latencyAggregationType,
      })
    : { latencyTimeseries: [], overallAvgDuration: null };

  const [currentPeriod, previousPeriod] = await Promise.all([
    currentPeriodPromise,
    previousPeriodPromise,
  ]);

  return {
    currentPeriod,
    previousPeriod: {
      ...previousPeriod,
      latencyTimeseries: offsetPreviousPeriodCoordinates({
        currentPeriodTimeseries: currentPeriod.latencyTimeseries,
        previousPeriodTimeseries: previousPeriod.latencyTimeseries,
      }),
    },
  };
}
