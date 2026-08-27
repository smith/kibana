/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiSelect } from '@elastic/eui';
import type { FormEvent } from 'react';
import { i18n } from '@kbn/i18n';
import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import styled from '@emotion/styled';
import type { CSSObject } from '@emotion/react';
import { useApmServiceContext } from '../../context/apm_service/use_apm_service_context';
import { useBreakpoints } from '../../hooks/use_breakpoints';
import * as urlHelpers from './links/url_helpers';

// The default transaction type (for non-RUM services) is "request". Set the
// min-width on here to the width when "request" is loaded so it doesn't start
// out collapsed and change its width when the list of transaction types is loaded.
const EuiSelectWithWidth = styled(EuiSelect)`
  min-width: 200px;
`;

// Sentinel URL value meaning "no transaction type filter". Distinct from
// undefined (which means "not yet chosen, auto-select the default").
export const TRANSACTION_TYPE_NONE = '__none__';

export function TransactionTypeSelect({
  compressed,
  hideLabel,
  fullWidth,
  cssOverride,
}: {
  compressed?: boolean;
  hideLabel?: boolean;
  fullWidth?: boolean;
  cssOverride?: CSSObject;
}) {
  const { isSmall } = useBreakpoints();
  const { transactionTypes, hasUntypedTransactions, transactionType } = useApmServiceContext();
  const history = useHistory();

  const handleChange = useCallback(
    (event: FormEvent<HTMLSelectElement>) => {
      urlHelpers.push(history, {
        query: { transactionType: event.currentTarget.value },
      });
    },
    [history]
  );

  // Only show the switcher when there are typed transaction types to choose between.
  // Pure OTel services (untyped spans only) have nothing to switch.
  if (transactionTypes.length === 0) {
    return null;
  }

  const typedOptions = transactionTypes.map((t) => ({ text: t, value: t }));

  // When there's a mix of typed and untyped spans, offer "None" as a choice.
  const options = [
    ...typedOptions,
    ...(hasUntypedTransactions
      ? [
          {
            text: i18n.translate('xpack.apm.transactionTypeSelect.none', {
              defaultMessage: 'None',
            }),
            value: TRANSACTION_TYPE_NONE,
          },
        ]
      : []),
  ];

  const currentValue = transactionType ?? TRANSACTION_TYPE_NONE;

  return (
    <EuiSelectWithWidth
      css={cssOverride}
      compressed={compressed !== false}
      fullWidth={fullWidth ?? isSmall}
      prepend={
        hideLabel
          ? undefined
          : i18n.translate('xpack.apm.transactionTypeSelect.label', {
              defaultMessage: 'Transaction type',
            })
      }
      aria-label={i18n.translate(
        'xpack.apm.serviceOverview.filterByTransactionTypeSelect.ariaLabel',
        { defaultMessage: 'Filter by transaction type select' }
      )}
      data-test-subj="headerFilterTransactionType"
      onChange={handleChange}
      options={options}
      value={currentValue}
    />
  );
}
