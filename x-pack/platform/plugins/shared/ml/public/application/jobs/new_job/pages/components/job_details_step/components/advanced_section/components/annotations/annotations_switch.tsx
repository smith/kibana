/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FC } from 'react';
import React, { useState, useContext, useEffect } from 'react';
import { i18n } from '@kbn/i18n';
import { EuiCallOut, EuiSwitch } from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n-react';
import { JobCreatorContext } from '../../../../../job_creator_context';
import { Description } from './description';

export const AnnotationsSwitch: FC = () => {
  const { jobCreator, jobCreatorUpdate, jobCreatorUpdated } = useContext(JobCreatorContext);
  const [annotationsEnabled, setAnnotationsEnabled] = useState(jobCreator.modelChangeAnnotations);
  const [showCallOut, setShowCallout] = useState(
    jobCreator.modelPlot && !jobCreator.modelChangeAnnotations
  );

  useEffect(() => {
    jobCreator.modelChangeAnnotations = annotationsEnabled;
    jobCreatorUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsEnabled]);

  useEffect(() => {
    setShowCallout(jobCreator.modelPlot && !annotationsEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobCreatorUpdated, annotationsEnabled]);

  function toggleAnnotations() {
    setAnnotationsEnabled(!annotationsEnabled);
  }

  return (
    <>
      <Description>
        <EuiSwitch
          name="switch"
          checked={annotationsEnabled}
          onChange={toggleAnnotations}
          data-test-subj="mlJobWizardSwitchAnnotations"
          label={i18n.translate(
            'xpack.ml.newJob.wizard.jobDetailsStep.advancedSection.enableModelPlotAnnotations.title',
            {
              defaultMessage: 'Enable model change annotations',
            }
          )}
        />
      </Description>
      {showCallOut && (
        <EuiCallOut
          data-test-subj="mlJobWizardAlsoEnableAnnotationsRecommendationCallout"
          title={
            <FormattedMessage
              id="xpack.ml.newJob.wizard.jobDetailsStep.advancedSection.annotationsSwitchCallout.title"
              defaultMessage="If you enable model plot with this configuration, we recommend you also enable annotations."
            />
          }
          color="primary"
          iconType="question"
        />
      )}
    </>
  );
};
