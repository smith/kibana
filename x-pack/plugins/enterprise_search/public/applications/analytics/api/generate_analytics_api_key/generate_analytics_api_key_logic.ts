/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createApiLogic } from '../../../shared/api_logic/create_api_logic';
import { HttpLogic } from '../../../shared/http';

interface APIKeyResponse {
  apiKey: {
    api_key: string;
    encoded: string;
    id: string;
    name: string;
  };
}

export const generateAnalyticsApiKey = async ({
  collectionName,
  keyName,
}: {
  collectionName: string;
  keyName: string;
}) => {
  const route = `/internal/elasticsearch/analytics/collections/${collectionName}/api_key`;

  return await HttpLogic.values.http.post<APIKeyResponse>(route, {
    body: JSON.stringify({
      keyName,
    }),
  });
};

export const generateAnalyticsApiKeyLogic = createApiLogic(
  ['generate_analytics_api_key_logic'],
  generateAnalyticsApiKey
);
