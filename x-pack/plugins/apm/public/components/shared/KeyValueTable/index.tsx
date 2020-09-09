/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import React, { TableHTMLAttributes } from 'react';
import {
  EuiTable,
  EuiTableProps,
  EuiTableBody,
  EuiTableRow,
  EuiTableRowCell,
  EuiTableHeader,
  EuiTableHeaderCell,
} from '@elastic/eui';
import { FormattedValue } from './FormattedValue';
import { KeyValuePair } from '../../../utils/flattenObject';

export function KeyValueTable({
  keyValuePairs,
  tableProps = {},
  scores: {},
}: {
  keyValuePairs: KeyValuePair[];
  scores: { [key: string]: number[] };
  tableProps?: EuiTableProps & TableHTMLAttributes<HTMLTableElement>;
}) {
  console.log({ keyValuePairs, scores });
  return (
    <EuiTable compressed {...tableProps}>
      <EuiTableHeader>
        <EuiTableHeaderCell> </EuiTableHeaderCell>
        <EuiTableHeaderCell> </EuiTableHeaderCell>
        <EuiTableHeaderCell>75th percentile </EuiTableHeaderCell>
        <EuiTableHeaderCell>95th percentile </EuiTableHeaderCell>
        <EuiTableHeaderCell>99th percentile </EuiTableHeaderCell>
      </EuiTableHeader>
      <EuiTableBody>
        {keyValuePairs.map(({ key, value }) => (
          <EuiTableRow key={key}>
            <EuiTableRowCell>
              <strong data-test-subj="dot-key">{key}</strong>
            </EuiTableRowCell>
            <EuiTableRowCell data-test-subj="value">
              <FormattedValue value={value} />
            </EuiTableRowCell>
            {scores[key] &&
              scores[key].map((score, index) => (
                <EuiTableRowCell
                  key={`${scores[key]}-${index}`}
                  data-test-subj="value"
                >
                  {score}
                </EuiTableRowCell>
              ))}
          </EuiTableRow>
        ))}
      </EuiTableBody>
    </EuiTable>
  );
}
