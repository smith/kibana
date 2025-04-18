/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import expect from '@kbn/expect';
import { FtrProviderContext } from '../ftr_provider_context';

export default function ({ getService, getPageObjects }: FtrProviderContext) {
  const retry = getService('retry');
  const browser = getService('browser');
  const esArchiver = getService('esArchiver');
  const kibanaServer = getService('kibanaServer');
  const security = getService('security');
  const testSubjects = getService('testSubjects');
  const { common, timePicker, discover, header } = getPageObjects([
    'common',
    'timePicker',
    'discover',
    'header',
  ]);

  describe('indexpattern without timefield', () => {
    before(async () => {
      await security.testUser.setRoles(['kibana_admin', 'kibana_timefield']);
      await esArchiver.loadIfNeeded(
        'src/platform/test/functional/fixtures/es_archiver/index_pattern_without_timefield'
      );
      await kibanaServer.savedObjects.clean({ types: ['search', 'index-pattern'] });
      await kibanaServer.importExport.load(
        'src/platform/test/functional/fixtures/kbn_archiver/index_pattern_without_timefield'
      );
      await kibanaServer.uiSettings.replace({
        defaultIndex: 'without-timefield',
        'timepicker:timeDefaults': '{  "from": "2019-01-18T19:37:13.000Z",  "to": "now"}',
      });
      await common.navigateToApp('discover');
    });

    after(async () => {
      await security.testUser.restoreDefaults();
      await kibanaServer.uiSettings.unset('timepicker:timeDefaults');
      await kibanaServer.uiSettings.unset('defaultIndex');
      await esArchiver.unload(
        'src/platform/test/functional/fixtures/es_archiver/index_pattern_without_timefield'
      );
      await kibanaServer.savedObjects.clean({ types: ['search', 'index-pattern'] });
    });

    it('should not display a timepicker', async () => {
      if (await timePicker.timePickerExists()) {
        throw new Error('Expected timepicker not to exist');
      }
    });

    it('should adapt sidebar fields when switching', async () => {
      await discover.selectIndexPattern('with-timefield');
      const timefieldExistsWithTimefield = await testSubjects.exists('field-@timestamp');
      expect(timefieldExistsWithTimefield).to.be(true);
      await discover.selectIndexPattern('without-timefield');
      await discover.waitForDocTableLoadingComplete();
      const timefieldExistsWithoutTimefield = await testSubjects.exists('field-@timestamp');
      expect(timefieldExistsWithoutTimefield).to.be(false);
    });

    it('should display a timepicker after switching to an index pattern with timefield', async () => {
      await discover.selectIndexPattern('with-timefield');
      await discover.waitForDocTableLoadingComplete();
      if (!(await timePicker.timePickerExists())) {
        throw new Error('Expected timepicker to exist');
      }
    });
    it('should switch between with and without timefield using the browser back button', async () => {
      await discover.selectIndexPattern('without-timefield');
      await discover.waitForDocTableLoadingComplete();
      await retry.waitForWithTimeout(
        'The timepicker not to exist',
        5000,
        async () => !(await timePicker.timePickerExists())
      );

      await discover.selectIndexPattern('with-timefield');
      await discover.waitForDocTableLoadingComplete();
      await retry.waitForWithTimeout(
        'The timepicker to exist',
        5000,
        async () => await timePicker.timePickerExists()
      );
      await retry.waitForWithTimeout(
        'index pattern to have been switched back to "without-timefield"',
        5000,
        async () => {
          // Navigating back
          await browser.goBack();
          await discover.waitForDocTableLoadingComplete();
          return (
            (await testSubjects.getVisibleText('discover-dataView-switch-link')) ===
            'without-timefield'
          );
        }
      );

      await retry.waitForWithTimeout(
        'The timepicker not to exist',
        5000,
        async () => !(await timePicker.timePickerExists())
      );
    });

    it('should disable the auto refresh interval when switching to a data view without a time field', async () => {
      const autoRefreshInterval = 5;
      await discover.selectIndexPattern('with-timefield');
      await timePicker.startAutoRefresh(autoRefreshInterval);
      let url = await browser.getCurrentUrl();
      expect(url).to.contain(`refreshInterval:(pause:!f,value:${autoRefreshInterval * 1000})`);
      await discover.selectIndexPattern('without-timefield');
      url = await browser.getCurrentUrl();
      expect(url).to.contain(`refreshInterval:(pause:!t,value:${autoRefreshInterval * 1000})`);
    });

    it('should allow switching from a saved search with a time field to a saved search without a time field', async () => {
      await common.navigateToApp('discover');
      await discover.selectIndexPattern('with-timefield');
      await header.waitUntilLoadingHasFinished();
      await discover.saveSearch('with-timefield');
      await discover.selectIndexPattern('without-timefield');
      await header.waitUntilLoadingHasFinished();
      await discover.saveSearch('without-timefield', true);
      await discover.loadSavedSearch('with-timefield');
      await header.waitUntilLoadingHasFinished();
      await discover.loadSavedSearch('without-timefield');
      await header.waitUntilLoadingHasFinished();
      await discover.assertHitCount('1');
    });

    it('should allow switching from data views with different timefields and sort correctly', async () => {
      await common.navigateToApp('discover');
      await discover.selectIndexPattern('with-timefield');
      await header.waitUntilLoadingHasFinished();
      let url = await browser.getCurrentUrl();
      expect(url).to.contain(`@timestamp`);

      await discover.selectIndexPattern('with-different-timefield');
      await header.waitUntilLoadingHasFinished();
      url = await browser.getCurrentUrl();
      expect(url).to.contain(`with-different-timefield`);
      await browser.goBack();
      await header.waitUntilLoadingHasFinished();
      url = await browser.getCurrentUrl();
      expect(url).to.contain(`@timestamp`);
    });
  });
}
