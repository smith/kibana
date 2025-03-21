/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { IRouter } from '@kbn/core/server';
import type { FillGapByIdQueryV1 } from '../../../../../common/routes/gaps/apis/fill';
import { fillGapByIdQuerySchemaV1 } from '../../../../../common/routes/gaps/apis/fill';
import type { ScheduleBackfillResponseV1 } from '../../../../../common/routes/backfill/apis/schedule';
import type { ILicenseState } from '../../../../lib';
import { verifyAccessAndContext } from '../../../lib';
import type { AlertingRequestHandlerContext } from '../../../../types';
import { INTERNAL_ALERTING_GAPS_FILL_BY_ID_API_PATH } from '../../../../types';
import { transformRequestV1 } from './transforms';
import { transformResponseV1 } from '../../../backfill/apis/schedule/transforms';

export const fillGapByIdRoute = (
  router: IRouter<AlertingRequestHandlerContext>,
  licenseState: ILicenseState
) => {
  router.post(
    {
      path: `${INTERNAL_ALERTING_GAPS_FILL_BY_ID_API_PATH}`,
      security: {
        authz: {
          enabled: false,
          reason: 'This route delegates authorization to the scoped ES client',
        },
      },
      validate: {
        query: fillGapByIdQuerySchemaV1,
      },
      options: {
        access: 'internal',
      },
    },
    router.handleLegacyErrors(
      verifyAccessAndContext(licenseState, async function (context, req, res) {
        const alertingContext = await context.alerting;
        const rulesClient = await alertingContext.getRulesClient();
        const query: FillGapByIdQueryV1 = req.query;

        const result = await rulesClient.fillGapById(transformRequestV1(query));

        const response: ScheduleBackfillResponseV1 = {
          body: transformResponseV1(result),
        };
        return res.ok(response);
      })
    )
  );
};
