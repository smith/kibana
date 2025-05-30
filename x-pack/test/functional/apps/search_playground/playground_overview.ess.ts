/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrProviderContext } from '../../ftr_provider_context';
import { createOpenAIConnector } from './utils/create_openai_connector';
import { MachineLearningCommonAPIProvider } from '../../services/ml/common_api';

import {
  createLlmProxy,
  LlmProxy,
} from '../../../observability_ai_assistant_api_integration/common/create_llm_proxy';

const esArchiveIndex =
  'src/platform/test/api_integration/fixtures/es_archiver/index_patterns/basic_index';

export default function (ftrContext: FtrProviderContext) {
  const { getService, getPageObjects } = ftrContext;
  const pageObjects = getPageObjects(['common', 'searchPlayground']);
  const commonAPI = MachineLearningCommonAPIProvider(ftrContext);
  const supertest = getService('supertest');
  const esArchiver = getService('esArchiver');

  const log = getService('log');
  const browser = getService('browser');

  const createIndex = async () => await esArchiver.load(esArchiveIndex);

  let proxy: LlmProxy;
  let removeOpenAIConnector: () => Promise<void>;
  const createConnector = async () => {
    removeOpenAIConnector = await createOpenAIConnector({
      supertest,
      requestHeader: commonAPI.getCommonRequestHeader(),
      proxy,
    });
  };

  describe('Playground', () => {
    before(async () => {
      proxy = await createLlmProxy(log);
      await pageObjects.common.navigateToApp('searchPlayground');
    });

    after(async () => {
      await esArchiver.unload(esArchiveIndex);
      proxy.close();
    });

    describe('setup Page', () => {
      it('is loaded successfully', async () => {
        await pageObjects.searchPlayground.PlaygroundStartChatPage.expectPlaygroundHeaderComponentsToExist();
        await pageObjects.searchPlayground.PlaygroundStartChatPage.expectPlaygroundHeaderComponentsToDisabled();
        await pageObjects.searchPlayground.PlaygroundStartChatPage.expectPlaygroundStartChatPageComponentsToExist();
        await pageObjects.searchPlayground.PlaygroundStartChatPage.expectPlaygroundStartChatPageIndexButtonExists();
      });

      describe('with gen ai connectors', () => {
        before(async () => {
          await createConnector();
          await browser.refresh();
        });

        after(async () => {
          await removeOpenAIConnector?.();
          await browser.refresh();
        });
        it('show success llm button', async () => {
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectShowSuccessLLMText();
        });
      });

      describe('without gen ai connectors', () => {
        it('should display the set up connectors button', async () => {
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectAddConnectorButtonExists();
        });

        it('creates a connector successfully', async () => {
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectOpenConnectorPagePlayground();
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectSuccessButtonAfterCreatingConnector(
            createConnector
          );
        });

        after(async () => {
          await removeOpenAIConnector?.();
          await browser.refresh();
        });
      });

      describe('without any indices', () => {
        it('show create index button', async () => {
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectCreateIndexButtonToExists();
        });

        it('show success button when index added', async () => {
          await createIndex();
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectOpenFlyoutAndSelectIndex();
        });

        after(async () => {
          await esArchiver.unload(esArchiveIndex);
          await browser.refresh();
        });
      });

      describe('with existing indices', () => {
        before(async () => {
          await createConnector();
          await createIndex();
          await pageObjects.searchPlayground.session.setSession();
          await browser.refresh();
        });

        it('can select index from dropdown and load chat page', async () => {
          await pageObjects.searchPlayground.PlaygroundStartChatPage.expectToSelectIndicesAndLoadChat();
        });

        after(async () => {
          await removeOpenAIConnector?.();
          await esArchiver.unload(esArchiveIndex);
          await browser.refresh();
        });
      });
    });

    describe('chat page', () => {
      before(async () => {
        await createConnector();
        await createIndex();
        await browser.refresh();
        await pageObjects.searchPlayground.PlaygroundChatPage.navigateToChatPage();
      });
      it('loads successfully', async () => {
        await pageObjects.searchPlayground.PlaygroundChatPage.expectChatWindowLoaded();
      });

      describe('chat', () => {
        it('works', async () => {
          const conversationInterceptor = proxy.intercept(
            'conversation',
            (body) =>
              body.tools?.find((fn) => fn.function.name === 'title_conversation') === undefined
          );

          await pageObjects.searchPlayground.PlaygroundChatPage.sendQuestion();

          const conversationSimulator = await conversationInterceptor.waitForIntercept();

          await conversationSimulator.next('My response');

          await conversationSimulator.complete();

          await pageObjects.searchPlayground.PlaygroundChatPage.expectChatWorks();
          await pageObjects.searchPlayground.PlaygroundChatPage.expectTokenTooltipExists();
        });

        it('open view code', async () => {
          await pageObjects.searchPlayground.PlaygroundChatPage.expectOpenViewCode();
        });

        it('show fields and code in view query', async () => {
          await pageObjects.searchPlayground.PlaygroundQueryPage.openQueryMode();
          await pageObjects.searchPlayground.PlaygroundQueryPage.expectViewQueryHasFields();
        });

        it('allows running the elasticsearch query', async () => {
          await pageObjects.searchPlayground.PlaygroundQueryPage.openQueryMode();
          await pageObjects.searchPlayground.PlaygroundQueryPage.setQueryModeQuestion('hello');
          await pageObjects.searchPlayground.PlaygroundQueryPage.expectCanRunQuery();
          await pageObjects.searchPlayground.PlaygroundQueryPage.expectQueryModeResultsContains(
            '"took":'
          );
        });

        it('show edit context', async () => {
          await pageObjects.searchPlayground.PlaygroundChatPage.openChatMode();
          await pageObjects.searchPlayground.PlaygroundChatPage.expectEditContextOpens(
            'basic_index',
            ['bar', 'baz', 'baz.keyword', 'foo', 'nestedField', 'nestedField.child']
          );
        });

        it('save selected fields between modes', async () => {
          await pageObjects.searchPlayground.PlaygroundChatPage.expectSaveFieldsBetweenModes();
        });

        it('click on manage connector button', async () => {
          await pageObjects.searchPlayground.PlaygroundChatPage.clickManageButton();
        });

        it('allows user to edit the elasticsearch query', async () => {
          await pageObjects.searchPlayground.PlaygroundQueryPage.openQueryMode();
          const newQuery = `{"query":{"multi_match":{"query":"{query}","fields":["baz"]}}}`;
          await pageObjects.searchPlayground.PlaygroundQueryPage.expectCanEditElasticsearchQuery(
            newQuery
          );
          await pageObjects.searchPlayground.PlaygroundQueryPage.resetElasticsearchQuery();
          await pageObjects.searchPlayground.PlaygroundQueryPage.expectQueryCodeToBe(
            '{\n"retriever":{\n"standard":{\n"query":{\n"multi_match":{\n"query":"{query}",\n"fields":[\n"baz"\n]\n}\n}\n}\n}\n}'
          );
        });
      });

      after(async () => {
        await removeOpenAIConnector?.();
        await esArchiver.unload(esArchiveIndex);
        await browser.refresh();
      });
    });
  });
}
