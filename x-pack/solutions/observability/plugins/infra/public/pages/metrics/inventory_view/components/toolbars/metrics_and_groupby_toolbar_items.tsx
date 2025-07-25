/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlexItem } from '@elastic/eui';
import React, { useMemo } from 'react';
import type { SnapshotMetricType } from '@kbn/metrics-data-access-plugin/common';
import { findInventoryModel } from '@kbn/metrics-data-access-plugin/common';
import useAsync from 'react-use/lib/useAsync';
import { toMetricOpt } from '../../../../../../common/snapshot_metric_i18n';
import { WaffleMetricControls } from '../waffle/metric_control';
import { WaffleGroupByControls } from '../waffle/waffle_group_by_controls';
import { WaffleSortControls } from '../waffle/waffle_sort_controls';
import { toGroupByOpt } from './toolbar_wrapper';
import type { ToolbarProps } from './types';

interface Props extends ToolbarProps {
  groupByFields: string[];
}

export const MetricsAndGroupByToolbarItems = (props: Props) => {
  const inventoryModel = findInventoryModel(props.nodeType);

  const { value: aggregations } = useAsync(
    () => inventoryModel.metrics.getAggregations(),
    [inventoryModel]
  );

  const metricOptions = useMemo(
    () =>
      (Object.keys(aggregations?.getAll() ?? {}) as SnapshotMetricType[])
        .map((metric) => toMetricOpt(metric, props.nodeType))
        .filter((v) => v) as Array<{ text: string; value: string }>,
    [aggregations, props.nodeType]
  );

  const groupByOptions = useMemo(
    () => props.groupByFields.map(toGroupByOpt),
    [props.groupByFields]
  );

  return (
    <>
      <EuiFlexItem grow={false}>
        <WaffleMetricControls
          options={metricOptions}
          metric={props.metric}
          onChange={props.changeMetric}
          onChangeCustomMetrics={props.changeCustomMetrics}
          customMetrics={props.customMetrics}
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <WaffleGroupByControls
          options={groupByOptions}
          groupBy={props.groupBy}
          nodeType={props.nodeType}
          onChange={props.changeGroupBy}
          onChangeCustomOptions={props.changeCustomOptions}
          customOptions={props.customOptions}
        />
      </EuiFlexItem>
      {props.view === 'map' && (
        <EuiFlexItem grow={false}>
          <WaffleSortControls sort={props.sort} onChange={props.changeSort} />
        </EuiFlexItem>
      )}
    </>
  );
};
