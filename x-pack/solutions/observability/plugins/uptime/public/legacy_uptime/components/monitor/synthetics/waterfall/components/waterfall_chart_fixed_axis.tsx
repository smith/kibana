/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  Axis,
  BarSeries,
  BarStyleAccessor,
  Chart,
  DomainRange,
  Position,
  ScaleType,
  Settings,
  TickFormatter,
  TooltipType,
  Tooltip,
} from '@elastic/charts';
import { i18n } from '@kbn/i18n';
import { useElasticChartsTheme } from '@kbn/charts-theme';
import { WaterfallChartFixedAxisContainer } from './styles';
import { WaterfallChartMarkers } from './waterfall_markers';

interface Props {
  tickFormat: TickFormatter;
  domain: DomainRange;
  barStyleAccessor: BarStyleAccessor;
}

export const WaterfallChartFixedAxis = ({ tickFormat, domain, barStyleAccessor }: Props) => {
  const chartBaseTheme = useElasticChartsTheme();

  return (
    <WaterfallChartFixedAxisContainer>
      <Chart className="axis-only-chart" data-test-subj="axisOnlyChart">
        <Tooltip type={TooltipType.None} />
        <Settings
          showLegend={false}
          rotation={90}
          baseTheme={chartBaseTheme}
          locale={i18n.getLocale()}
        />

        <Axis
          id="time"
          position={Position.Top}
          tickFormat={tickFormat}
          domain={domain}
          gridLine={{
            visible: true,
          }}
        />

        <BarSeries
          aria-hidden={true}
          id="waterfallItems"
          xScaleType={ScaleType.Ordinal}
          yScaleType={ScaleType.Linear}
          xAccessor="x"
          yAccessors={['y']}
          y0Accessors={['y0']}
          styleAccessor={barStyleAccessor}
          data={[{ x: 0, y0: 0, y1: 1 }]}
        />
        <WaterfallChartMarkers />
      </Chart>
    </WaterfallChartFixedAxisContainer>
  );
};
