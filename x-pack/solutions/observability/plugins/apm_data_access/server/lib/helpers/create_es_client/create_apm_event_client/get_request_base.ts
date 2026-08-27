/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESFilter } from '@kbn/es-types';
import { ProcessorEvent } from '@kbn/apm-types-shared';
import { uniq } from 'lodash';
import { KIND, PROCESSOR_EVENT } from '@kbn/apm-types/es_fields';
import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import { getConfigForDocumentType, getProcessorEventForDocumentType } from '../document_type';
import type { ApmDataSource } from '../../../../../common/data_source';

export const OTEL_NO_PROCESSOR_EVENT: ESFilter = {
  bool: { must_not: { exists: { field: PROCESSOR_EVENT } } },
};

const processorEventIndexMap = {
  [ProcessorEvent.transaction]: 'transaction',
  [ProcessorEvent.span]: 'span',
  [ProcessorEvent.metric]: 'metric',
  [ProcessorEvent.error]: 'error',
} as const;

export function processorEventsToIndex(events: ProcessorEvent[], indices: APMIndices) {
  return uniq(
    events.flatMap((event) =>
      indices[processorEventIndexMap[event]].split(',').map((str) => str.trim())
    )
  );
}

export function getRequestBase(options: {
  apm: { events: ProcessorEvent[] } | { sources: ApmDataSource[] };
  indices: APMIndices;
  skipProcessorEventFilter?: boolean;
}) {
  const events =
    'events' in options.apm
      ? options.apm.events
      : options.apm.sources.map((source) => getProcessorEventForDocumentType(source.documentType));

  const index = processorEventsToIndex(events, options.indices);

  let filters: ESFilter[];
  if (options.skipProcessorEventFilter === true) {
    filters = [];
  } else {
    const hasTransactions = events.includes(ProcessorEvent.transaction);
    const hasSpans = events.includes(ProcessorEvent.span);

    if (hasTransactions || hasSpans) {
      // For queries that target transactions or spans, also match unprocessed
      // OTel data (no processor.event). Enriched APM docs always have
      // processor.event; OTel docs sent without the elasticapmprocessor do not.
      //
      // Transaction queries include ANY OTel span regardless of kind — service
      // discovery should not be limited to Server/Consumer spans. Queries that
      // specifically need entry-point semantics (transaction groups, latency
      // charts) add their own kind filter on top.
      //
      // Span queries exclude Server/Consumer to avoid double-counting entry
      // spans as both transactions and spans in mixed queries.
      const shoulds: ESFilter[] = [{ terms: { [PROCESSOR_EVENT]: events } }];

      if (hasTransactions) {
        shoulds.push(OTEL_NO_PROCESSOR_EVENT);
      }

      if (hasSpans) {
        shoulds.push({
          bool: {
            must: [OTEL_NO_PROCESSOR_EVENT],
            must_not: [{ terms: { [KIND]: ['Server', 'Consumer'] } }],
          },
        });
      }

      filters = [{ bool: { should: shoulds, minimum_should_match: 1 } }];
    } else {
      filters = [{ terms: { [PROCESSOR_EVENT]: events } }];
    }
  }

  if ('sources' in options.apm) {
    options.apm.sources.forEach((source) => {
      const documentTypeConfig = getConfigForDocumentType(source.documentType);
      if ('getQuery' in documentTypeConfig) {
        filters.push(documentTypeConfig.getQuery(source.rollupInterval));
      }
    });
  }

  return {
    index,
    events,
    filters,
  };
}
