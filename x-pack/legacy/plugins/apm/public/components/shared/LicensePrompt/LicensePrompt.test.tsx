/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import React, { FunctionComponent } from 'react';
import { render } from '@testing-library/react';
import { LicensePrompt } from './';
import {
  MockApmPluginContextWrapper,
  mockApmPluginContextValue
} from '../../../context/ApmPluginContext/MockApmPluginContext';
import { ApmPluginContextValue } from '../../../context/ApmPluginContext';

describe('LicensePrompt', () => {
  it('renders', () => {
    const props = { text: 'test' };
    expect(() =>
      render(<LicensePrompt {...props} />, {
        wrapper: MockApmPluginContextWrapper
      })
    ).not.toThrowError();
  });

  describe('when cloud is not enabled', () => {
    it('links to license management', async () => {
      const element = await render(<LicensePrompt text="test text" />, {
        wrapper: MockApmPluginContextWrapper
      }).findByTestId('LicensePrompt EuiButton');

      expect(element.getAttribute('href')).toContain('/license_management');
    });
  });

  describe('when cloud is enabled', () => {
    it('links to cloud account', async () => {
      const contextValue = ({
        ...mockApmPluginContextValue,
        plugins: {
          ...mockApmPluginContextValue.plugins,
          cloud: { isCloudEnabled: true }
        }
      } as unknown) as ApmPluginContextValue;
      const wrapper: FunctionComponent = ({ children }) => (
        <MockApmPluginContextWrapper value={contextValue}>
          {children}
        </MockApmPluginContextWrapper>
      );
      const element = await render(<LicensePrompt text="test text" />, {
        wrapper
      }).findByTestId('LicensePrompt EuiButton');

      expect(element.getAttribute('href')).toEqual(
        'https://cloud.elastic.co/account/billing'
      );
    });
  });
});
