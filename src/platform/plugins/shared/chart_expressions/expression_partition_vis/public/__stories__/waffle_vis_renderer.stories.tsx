/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { FC, PropsWithChildren } from 'react';
import type { StoryFn } from '@storybook/react';
import { Render } from '@kbn/presentation-util-plugin/public/__stories__';
import { getPartitionVisRenderer } from '../expression_renderers';
import { ChartTypes, PartitionChartProps } from '../../common/types';
import { getStartDeps } from '../__mocks__';
import { waffleArgTypes, waffleConfig, data } from './shared';

const containerSize = {
  width: '700px',
  height: '700px',
};

const PartitionVisRenderer = () => getPartitionVisRenderer({ getStartDeps });

type Props = {
  visType: PartitionChartProps['visType'];
  syncColors: PartitionChartProps['syncColors'];
} & PartitionChartProps['visConfig'];

const PartitionVis: StoryFn<FC<PropsWithChildren<Props>>> = ({
  visType,
  syncColors,
  children,
  ...visConfig
}) => (
  <Render
    renderer={PartitionVisRenderer}
    config={{ visType, syncColors, visConfig, visData: data }}
    {...containerSize}
  />
);

export default {
  title: 'renderers/waffleVis',
  component: PartitionVis,
  argTypes: waffleArgTypes,
};

const Default = PartitionVis.bind({});
Default.args = { ...waffleConfig, visType: ChartTypes.WAFFLE, syncColors: false };

export { Default };
