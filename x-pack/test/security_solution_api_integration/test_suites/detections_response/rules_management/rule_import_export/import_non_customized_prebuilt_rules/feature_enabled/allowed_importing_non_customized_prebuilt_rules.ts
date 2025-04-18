/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from 'expect';
import { FtrProviderContext } from '../../../../../../ftr_provider_context';
import {
  createPrebuiltRuleAssetSavedObjects,
  createRuleAssetSavedObject,
  deleteAllPrebuiltRuleAssets,
  getCustomQueryRuleParams,
} from '../../../../utils';
import { deleteAllRules } from '../../../../../../../common/utils/security_solution';
import { combineToNdJson } from '../../../../utils/combine_to_ndjson';

export default ({ getService }: FtrProviderContext): void => {
  const es = getService('es');
  const securitySolutionApi = getService('securitySolutionApi');
  const supertest = getService('supertest');
  const log = getService('log');

  describe('@ess @serverless @skipInServerlessMKI Import - Customization Enabled', () => {
    beforeEach(async () => {
      await deleteAllRules(supertest, log);
      await deleteAllPrebuiltRuleAssets(es, log);
    });

    it(`imports non-customized prebuilt rules`, async () => {
      const ruleId = 'prebuilt-rule';
      const ruleParams = getCustomQueryRuleParams({
        rule_id: ruleId,
        // @ts-expect-error the API supports this param, but we only need it in {@link RuleToImport}
        immutable: true,
        rule_source: { type: 'external', is_customized: false },
        version: 1,
      });
      const ruleAsset = createRuleAssetSavedObject(ruleParams);

      await createPrebuiltRuleAssetSavedObjects(es, [ruleAsset]);

      const ndjson = combineToNdJson(ruleParams);

      const { body } = await securitySolutionApi
        .importRules({ query: {} })
        .attach('file', Buffer.from(ndjson), 'rules.ndjson')
        .expect(200);

      expect(body).toMatchObject({
        success: true,
        errors: [],
      });

      const { body: importedRule } = await securitySolutionApi
        .readRule({
          query: { rule_id: ruleId },
        })
        .expect(200);

      expect(importedRule).toMatchObject(ruleParams);
    });
  });
};
