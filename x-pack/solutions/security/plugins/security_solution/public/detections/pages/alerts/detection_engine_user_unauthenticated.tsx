/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { EmptyPage } from '../../../common/components/empty_page';
import * as i18n from './translations';
import { useKibana } from '../../../common/lib/kibana';

export const DetectionEngineUserUnauthenticated = React.memo(() => {
  const docLinks = useKibana().services.docLinks;
  const actions = useMemo(
    () => ({
      detectionUnauthenticated: {
        icon: 'documents',
        label: i18n.GO_TO_DOCUMENTATION,
        url: `${docLinks.links.siem.detectionsReq}`,
        target: '_blank',
      },
    }),
    [docLinks]
  );
  return (
    <EmptyPage
      actions={actions}
      message={i18n.USER_UNAUTHENTICATED_MSG_BODY}
      data-test-subj="no_index"
      title={i18n.USER_UNAUTHENTICATED_TITLE}
    />
  );
});

DetectionEngineUserUnauthenticated.displayName = 'DetectionEngineUserUnauthenticated';
