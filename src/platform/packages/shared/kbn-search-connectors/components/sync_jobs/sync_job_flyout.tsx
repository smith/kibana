/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';

import {
  EuiBasicTable,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiTitle,
  useGeneratedHtmlId,
} from '@elastic/eui';

import { i18n } from '@kbn/i18n';

import { ConnectorSyncJob } from '../../types';
import { SyncJobDocumentsPanel } from './documents_panel';
import { SyncJobEventsPanel } from './events_panel';
import { FilteringPanel } from './filtering_panel';
import { FlyoutPanel } from './flyout_panel';
import { PipelinePanel } from './pipeline_panel';
import { SyncJobCallouts } from './sync_callouts';

interface SyncJobFlyoutProps {
  onClose: () => void;
  syncJob?: ConnectorSyncJob;
}

export const SyncJobFlyout: React.FC<SyncJobFlyoutProps> = ({ onClose, syncJob }) => {
  const modalTitleId = useGeneratedHtmlId();

  const filtering = syncJob?.connector.filtering
    ? Array.isArray(syncJob?.connector.filtering)
      ? syncJob?.connector.filtering?.[0]
      : syncJob?.connector.filtering
    : null;
  const visible = !!syncJob;
  return visible ? (
    <EuiFlyout onClose={onClose} aria-labelledby={modalTitleId}>
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2 id={modalTitleId}>
            {i18n.translate('searchConnectors.syncJobs.flyout.title', {
              defaultMessage: 'Event log',
            })}
          </h2>
        </EuiTitle>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiFlexGroup direction="column">
          <SyncJobCallouts syncJob={syncJob} />
          <EuiFlexItem>
            <FlyoutPanel
              title={i18n.translate('searchConnectors.syncJobs.flyout.sync', {
                defaultMessage: 'Sync',
              })}
            >
              <EuiBasicTable
                columns={[
                  {
                    field: 'id',
                    name: i18n.translate('searchConnectors.syncJobs.flyout.sync.id', {
                      defaultMessage: 'ID',
                    }),
                  },
                  {
                    field: 'index_name',
                    name: i18n.translate('searchConnectors.syncJobs.flyout.sync.index', {
                      defaultMessage: 'Index name',
                    }),
                  },
                ]}
                items={[{ id: syncJob.id, index_name: syncJob.connector.index_name }]}
              />
            </FlyoutPanel>
          </EuiFlexItem>
          <EuiFlexItem>
            <SyncJobDocumentsPanel
              added={syncJob.indexed_document_count}
              removed={syncJob.deleted_document_count}
              volume={syncJob.indexed_document_volume ?? 0}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <SyncJobEventsPanel
              canceledAt={syncJob.canceled_at ?? ''}
              cancelationRequestedAt={syncJob.cancelation_requested_at ?? ''}
              syncRequestedAt={syncJob.created_at}
              syncStarted={syncJob.started_at ?? ''}
              completed={syncJob.completed_at ?? ''}
              lastUpdated={syncJob.last_seen ?? ''}
              triggerMethod={syncJob.trigger_method}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <FilteringPanel
              advancedSnippet={filtering?.advanced_snippet}
              filteringRules={filtering?.rules ?? []}
            />
          </EuiFlexItem>
          {syncJob.connector?.pipeline && (
            <EuiFlexItem>
              <PipelinePanel pipeline={syncJob.connector.pipeline} />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      </EuiFlyoutBody>
    </EuiFlyout>
  ) : (
    <></>
  );
};
