/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FC } from 'react';
import React from 'react';
import { i18n } from '@kbn/i18n';
import { useTimefilter } from '@kbn/ml-date-picker';
import { dynamic } from '@kbn/shared-ux-utility';
import { ML_PAGES } from '../../../../locator';
import type { MlRoute } from '../../router';
import { createPath, PageLoader } from '../../router';
import { useRouteResolver } from '../../use_resolver';
import { usePermissionCheck } from '../../../capabilities/check_capabilities';
import { getMlNodeCount } from '../../../ml_nodes_check/check_ml_nodes';
import { type NavigateToApp, getADSettingsBreadcrumbs } from '../../breadcrumbs';

const FilterLists = dynamic(async () => ({
  default: (await import('../../../settings/filter_lists')).FilterLists,
}));

export const filterListRouteFactory = (navigateToApp: NavigateToApp): MlRoute => ({
  path: createPath(ML_PAGES.FILTER_LISTS_MANAGE),
  title: i18n.translate('xpack.ml.settings.filterList.docTitle', {
    defaultMessage: 'Filters',
  }),
  render: () => <PageWrapper />,
  breadcrumbs: [
    ...getADSettingsBreadcrumbs(navigateToApp),
    {
      text: i18n.translate('xpack.ml.anomalyDetection.filterListsManagementLabel', {
        defaultMessage: 'Filter lists',
      }),
    },
  ],
});

const PageWrapper: FC = () => {
  const { context } = useRouteResolver('full', ['canGetFilters'], { getMlNodeCount });

  useTimefilter({ timeRangeSelector: false, autoRefreshSelector: false });

  const [canCreateFilter, canDeleteFilter] = usePermissionCheck([
    'canCreateFilter',
    'canDeleteFilter',
  ]);

  return (
    <PageLoader context={context}>
      <FilterLists {...{ canCreateFilter, canDeleteFilter }} />
    </PageLoader>
  );
};
