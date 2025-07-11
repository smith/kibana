/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/*
 * React component for rendering Single Metric Viewer.
 */

import { find, get, has, isEqual } from 'lodash';
import moment from 'moment-timezone';
import {
  Subject,
  Subscription,
  forkJoin,
  map,
  debounceTime,
  switchMap,
  tap,
  withLatestFrom,
} from 'rxjs';
import PropTypes from 'prop-types';
import React, { createRef, Fragment } from 'react';

import {
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiPanel,
  EuiTitle,
  EuiAccordion,
  EuiBadge,
  EuiTextColor,
} from '@elastic/eui';

import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import { context } from '@kbn/kibana-react-plugin/public';
import { getBoundsRoundedToInterval } from '@kbn/ml-time-buckets';
import { ResizeChecker } from '@kbn/kibana-utils-plugin/public';

import { ANOMALIES_TABLE_DEFAULT_QUERY_SIZE } from '../../../common/constants/search';
import {
  isModelPlotEnabled,
  isModelPlotChartableForDetector,
  isSourceDataChartableForDetector,
  isTimeSeriesViewJob,
  mlFunctionToESAggregation,
} from '../../../common/util/job_utils';

import { AnnotationFlyout } from '../components/annotations/annotation_flyout';
import { AnnotationsTable } from '../components/annotations/annotations_table';
import { AnomaliesTable } from '../components/anomalies_table/anomalies_table';
import { LoadingIndicator } from '../components/loading_indicator/loading_indicator';
import { SelectInterval } from '../components/controls/select_interval/select_interval';
import { SelectSeverity } from '../components/controls/select_severity';
import { forecastServiceFactory } from '../services/forecast_service';
import { timeSeriesExplorerServiceFactory } from '../util/time_series_explorer_service';
import { mlJobServiceFactory } from '../services/job_service';
import { mlResultsServiceProvider } from '../services/results_service';
import { toastNotificationServiceProvider } from '../services/toast_notification_service';

import { TimeseriesexplorerNoChartData } from './components/timeseriesexplorer_no_chart_data';
import { TimeSeriesExplorerPage } from './timeseriesexplorer_page';
import { TimeSeriesExplorerHelpPopover } from './timeseriesexplorer_help_popover';

import {
  APP_STATE_ACTION,
  CHARTS_POINT_TARGET,
  TIME_FIELD_NAME,
} from './timeseriesexplorer_constants';
import { timeSeriesSearchServiceFactory } from './timeseriesexplorer_utils/time_series_search_service';
import { getTimeseriesexplorerDefaultState } from './timeseriesexplorer_utils';
import { ANOMALY_DETECTION_DEFAULT_TIME_RANGE } from '../../../common/constants/settings';
import { getControlsForDetector } from './get_controls_for_detector';
import { SeriesControls } from './components/series_controls';
import { TimeSeriesChartWithTooltips } from './components/timeseries_chart/timeseries_chart_with_tooltip';
import { aggregationTypeTransform } from '@kbn/ml-anomaly-utils';
import { isMetricDetector } from './get_function_description';
import { getViewableDetectors } from './timeseriesexplorer_utils/get_viewable_detectors';
import { TimeseriesexplorerChartDataError } from './components/timeseriesexplorer_chart_data_error';
import { ExplorerNoJobsSelected } from '../explorer/components';
import { getDataViewsAndIndicesWithGeoFields } from '../explorer/explorer_utils';
import { indexServiceFactory } from '../util/index_service';
import { TimeSeriesExplorerControls } from './components/timeseriesexplorer_controls';

// Used to indicate the chart is being plotted across
// all partition field values, where the cardinality of the field cannot be
// obtained as it is not aggregatable e.g. 'all distinct kpi_indicator values'
const allValuesLabel = i18n.translate('xpack.ml.timeSeriesExplorer.allPartitionValuesLabel', {
  defaultMessage: 'all',
});

const containerPadding = 34;

export class TimeSeriesExplorer extends React.Component {
  static contextType = context;

  static propTypes = {
    appStateHandler: PropTypes.func.isRequired,
    autoZoomDuration: PropTypes.number.isRequired,
    bounds: PropTypes.object.isRequired,
    dateFormatTz: PropTypes.string.isRequired,
    lastRefresh: PropTypes.number.isRequired,
    previousRefresh: PropTypes.number,
    selectedJobId: PropTypes.string.isRequired,
    selectedDetectorIndex: PropTypes.number,
    selectedEntities: PropTypes.object,
    selectedForecastId: PropTypes.string,
    tableInterval: PropTypes.string,
    tableSeverity: PropTypes.object,
    zoom: PropTypes.object,
    handleJobSelectionChange: PropTypes.func,
  };

  state = getTimeseriesexplorerDefaultState();

  subscriptions = new Subscription();

  resizeRef = createRef();
  resizeChecker = undefined;
  resizeHandler = () => {
    this.setState({
      svgWidth:
        this.resizeRef.current !== null ? this.resizeRef.current.offsetWidth - containerPadding : 0,
    });
  };
  unmounted = false;

  /**
   * Subject for listening brush time range selection.
   */
  contextChart$ = new Subject();

  /**
   * Access ML services in react context.
   */
  static contextType = context;

  dataViewsService;
  toastNotificationService;
  mlApi;
  mlForecastService;
  mlIndexUtils;
  mlJobService;
  mlResultsService;
  mlTimeSeriesExplorer;
  mlTimeSeriesSearchService;

  constructor(props, constructorContext) {
    super(props, constructorContext);
    this.dataViewsService = constructorContext.services.data.dataViews;
    this.toastNotificationService = toastNotificationServiceProvider(
      constructorContext.services.notifications.toasts
    );
    this.mlApi = constructorContext.services.mlServices.mlApi;
    this.mlForecastService = forecastServiceFactory(this.mlApi);
    this.mlIndexUtils = indexServiceFactory(this.dataViewsService);
    this.mlJobService = mlJobServiceFactory(this.mlApi);
    this.mlResultsService = mlResultsServiceProvider(this.mlApi);
    this.mlTimeSeriesExplorer = timeSeriesExplorerServiceFactory(
      constructorContext.services.uiSettings,
      this.mlApi,
      this.mlResultsService
    );
    this.mlTimeSeriesSearchService = timeSeriesSearchServiceFactory(
      this.mlResultsService,
      this.mlApi
    );
  }

  /**
   * Returns field names that don't have a selection yet.
   */
  getFieldNamesWithEmptyValues = () => {
    const latestEntityControls = this.getControlsForDetector();
    return latestEntityControls
      .filter(({ fieldValue }) => fieldValue === null)
      .map(({ fieldName }) => fieldName);
  };

  /**
   * Checks if all entity control dropdowns have a selection.
   */
  arePartitioningFieldsProvided = () => {
    const fieldNamesWithEmptyValues = this.getFieldNamesWithEmptyValues();
    return fieldNamesWithEmptyValues.length === 0;
  };

  toggleShowAnnotationsHandler = () => {
    this.setState((prevState) => ({
      showAnnotations: !prevState.showAnnotations,
    }));
  };

  toggleShowForecastHandler = () => {
    this.setState((prevState) => ({
      showForecast: !prevState.showForecast,
    }));
  };

  toggleShowModelBoundsHandler = () => {
    this.setState({
      showModelBounds: !this.state.showModelBounds,
    });
  };

  setFunctionDescription = (selectedFuction) => {
    this.props.appStateHandler(APP_STATE_ACTION.SET_FUNCTION_DESCRIPTION, selectedFuction);
  };

  previousChartProps = {};
  previousShowAnnotations = undefined;
  previousShowForecast = undefined;
  previousShowModelBounds = undefined;

  tableFilter = (field, value, operator) => {
    const entities = this.getControlsForDetector();
    const entity = entities.find(({ fieldName }) => fieldName === field);

    if (entity === undefined) {
      return;
    }

    const { appStateHandler } = this.props;

    let resultValue = '';
    if (operator === '+' && entity.fieldValue !== value) {
      resultValue = value;
    } else if (operator === '-' && entity.fieldValue === value) {
      resultValue = null;
    } else {
      return;
    }

    const resultEntities = {
      ...entities.reduce((appStateEntities, appStateEntity) => {
        appStateEntities[appStateEntity.fieldName] = appStateEntity.fieldValue;
        return appStateEntities;
      }, {}),
      [entity.fieldName]: resultValue,
    };

    appStateHandler(APP_STATE_ACTION.SET_ENTITIES, resultEntities);
  };

  contextChartSelectedInitCallDone = false;

  getFocusAggregationInterval(selection) {
    const { selectedJobId } = this.props;
    const selectedJob = this.mlJobService.getJob(selectedJobId);

    // Calculate the aggregation interval for the focus chart.
    const bounds = { min: moment(selection.from), max: moment(selection.to) };

    return this.mlTimeSeriesExplorer.calculateAggregationInterval(
      bounds,
      CHARTS_POINT_TARGET,
      selectedJob
    );
  }

  /**
   * Gets focus data for the current component state
   */
  getFocusData(selection) {
    const { selectedJobId, selectedForecastId, selectedDetectorIndex, functionDescription } =
      this.props;
    const { modelPlotEnabled } = this.state;
    const selectedJob = this.mlJobService.getJob(selectedJobId);
    if (isMetricDetector(selectedJob, selectedDetectorIndex) && functionDescription === undefined) {
      return;
    }
    const entityControls = this.getControlsForDetector();

    // Calculate the aggregation interval for the focus chart.
    const bounds = { min: moment(selection.from), max: moment(selection.to) };
    const focusAggregationInterval = this.getFocusAggregationInterval(selection);

    // Ensure the search bounds align to the bucketing interval so that the first and last buckets are complete.
    // For sum or count detectors, short buckets would hold smaller values, and model bounds would also be affected
    // to some extent with all detector functions if not searching complete buckets.
    const searchBounds = getBoundsRoundedToInterval(bounds, focusAggregationInterval, false);

    return this.mlTimeSeriesExplorer.getFocusData(
      this.getCriteriaFields(selectedDetectorIndex, entityControls),
      selectedDetectorIndex,
      focusAggregationInterval,
      selectedForecastId,
      modelPlotEnabled,
      entityControls.filter((entity) => entity.fieldValue !== null),
      searchBounds,
      selectedJob,
      functionDescription,
      TIME_FIELD_NAME
    );
  }

  contextChartSelected = (selection) => {
    const zoomState = {
      from: selection.from.toISOString(),
      to: selection.to.toISOString(),
    };

    if (
      isEqual(this.props.zoom, zoomState) &&
      this.state.focusChartData !== undefined &&
      this.props.previousRefresh === this.props.lastRefresh
    ) {
      return;
    }

    this.contextChart$.next(selection);
    this.props.appStateHandler(APP_STATE_ACTION.SET_ZOOM, zoomState);
  };

  loadAnomaliesTableData = (earliestMs, latestMs) => {
    const {
      dateFormatTz,
      selectedDetectorIndex,
      selectedJobId,
      tableInterval,
      tableSeverity,
      functionDescription,
    } = this.props;
    const mlJobService = this.mlJobService;
    const selectedJob = mlJobService.getJob(selectedJobId);
    const entityControls = this.getControlsForDetector();

    const mlApi = this.mlApi;
    return mlApi.results
      .getAnomaliesTableData(
        [selectedJob.job_id],
        this.getCriteriaFields(selectedDetectorIndex, entityControls),
        [],
        tableInterval,
        tableSeverity.val,
        earliestMs,
        latestMs,
        dateFormatTz,
        ANOMALIES_TABLE_DEFAULT_QUERY_SIZE,
        undefined,
        undefined,
        functionDescription
      )
      .pipe(
        map((resp) => {
          const anomalies = resp.anomalies;
          const detectorsByJob = mlJobService.detectorsByJob;
          anomalies.forEach((anomaly) => {
            // Add a detector property to each anomaly.
            // Default to functionDescription if no description available.
            // TODO - when job_service is moved server_side, move this to server endpoint.
            const jobId = anomaly.jobId;
            const detector = get(detectorsByJob, [jobId, anomaly.detectorIndex]);
            anomaly.detector = get(
              detector,
              ['detector_description'],
              anomaly.source.function_description
            );

            // For detectors with rules, add a property with the rule count.
            const customRules = detector.custom_rules;
            if (customRules !== undefined) {
              anomaly.rulesLength = customRules.length;
            }

            // Add properties used for building the links menu.
            // TODO - when job_service is moved server_side, move this to server endpoint.
            if (has(mlJobService.customUrlsByJob, jobId)) {
              anomaly.customUrls = mlJobService.customUrlsByJob[jobId];
            }
          });

          return {
            tableData: {
              anomalies,
              interval: resp.interval,
              examplesByJobId: resp.examplesByJobId,
              showViewSeriesLink: false,
            },
          };
        })
      );
  };

  setForecastId = (forecastId) => {
    this.props.appStateHandler(APP_STATE_ACTION.SET_FORECAST_ID, forecastId);
  };

  displayErrorToastMessages = (error, errorMsg) => {
    if (this.toastNotificationService) {
      this.toastNotificationService.displayErrorToast(error, errorMsg, 2000);
    }
    this.setState({ loading: false, chartDataError: errorMsg });
  };

  loadSingleMetricData = (fullRefresh = true) => {
    const mlJobService = this.mlJobService;
    const {
      autoZoomDuration,
      bounds,
      selectedDetectorIndex,
      selectedForecastId,
      selectedJobId,
      zoom,
      functionDescription,
    } = this.props;

    const { loadCounter: currentLoadCounter } = this.state;

    const currentSelectedJob = mlJobService.getJob(selectedJobId);
    if (currentSelectedJob === undefined) {
      return;
    }
    if (
      isMetricDetector(currentSelectedJob, selectedDetectorIndex) &&
      functionDescription === undefined
    ) {
      return;
    }

    const functionToPlotByIfMetric = aggregationTypeTransform.toES(functionDescription);

    this.contextChartSelectedInitCallDone = false;

    // Only when `fullRefresh` is true we'll reset all data
    // and show the loading spinner within the page.
    const entityControls = this.getControlsForDetector();
    this.setState(
      {
        fullRefresh,
        loadCounter: currentLoadCounter + 1,
        loading: true,
        chartDataError: undefined,
        ...(fullRefresh
          ? {
              chartDetails: undefined,
              contextChartData: undefined,
              contextForecastData: undefined,
              focusChartData: undefined,
              focusForecastData: undefined,
              modelPlotEnabled:
                isModelPlotChartableForDetector(currentSelectedJob, selectedDetectorIndex) &&
                isModelPlotEnabled(currentSelectedJob, selectedDetectorIndex, entityControls),
              hasResults: false,
              dataNotChartable: false,
            }
          : {}),
      },
      () => {
        const { loadCounter, modelPlotEnabled } = this.state;

        const selectedJob = mlJobService.getJob(selectedJobId);
        const detectorIndex = selectedDetectorIndex;

        let awaitingCount = 3;

        const stateUpdate = {};

        // finish() function, called after each data set has been loaded and processed.
        // The last one to call it will trigger the page render.
        const finish = (counterVar) => {
          awaitingCount--;
          if (awaitingCount === 0 && counterVar === loadCounter) {
            stateUpdate.hasResults =
              (Array.isArray(stateUpdate.contextChartData) &&
                stateUpdate.contextChartData.length > 0) ||
              (Array.isArray(stateUpdate.contextForecastData) &&
                stateUpdate.contextForecastData.length > 0);
            stateUpdate.loading = false;

            // Set zoomFrom/zoomTo attributes in scope which will result in the metric chart automatically
            // selecting the specified range in the context chart, and so loading that date range in the focus chart.
            // Only touch the zoom range if data for the context chart has been loaded and all necessary
            // partition fields have a selection.
            if (
              stateUpdate.contextChartData.length &&
              this.arePartitioningFieldsProvided() === true
            ) {
              // Check for a zoom parameter in the appState (URL).
              let focusRange = this.mlTimeSeriesExplorer.calculateInitialFocusRange(
                zoom,
                stateUpdate.contextAggregationInterval,
                bounds
              );

              if (
                // If the user's focus range is not defined (i.e. no 'zoom' parameter restored from the appState URL),
                // then calculate the default focus range to use
                zoom === undefined ||
                focusRange === undefined
              ) {
                focusRange = this.mlTimeSeriesExplorer.calculateDefaultFocusRange(
                  autoZoomDuration,
                  stateUpdate.contextAggregationInterval,
                  stateUpdate.contextChartData,
                  stateUpdate.contextForecastData
                );
                this.previousSelectedForecastId = this.props.selectedForecastId;
              }

              if (focusRange !== undefined) {
                this.contextChartSelected({
                  from: focusRange[0],
                  to: focusRange[1],
                });
              }
            }

            this.setState(stateUpdate);
          }
        };

        const nonBlankEntities = entityControls.filter((entity) => {
          return entity.fieldValue !== null;
        });

        if (
          modelPlotEnabled === false &&
          isSourceDataChartableForDetector(selectedJob, detectorIndex) === false &&
          nonBlankEntities.length > 0
        ) {
          // For detectors where model plot has been enabled with a terms filter and the
          // selected entity(s) are not in the terms list, indicate that data cannot be viewed.
          stateUpdate.hasResults = false;
          stateUpdate.loading = false;
          stateUpdate.dataNotChartable = true;
          this.setState(stateUpdate);
          return;
        }

        // Calculate the aggregation interval for the context chart.
        // Context chart swimlane will display bucket anomaly score at the same interval.
        stateUpdate.contextAggregationInterval =
          this.mlTimeSeriesExplorer.calculateAggregationInterval(
            bounds,
            CHARTS_POINT_TARGET,
            selectedJob
          );

        // Ensure the search bounds align to the bucketing interval so that the first and last buckets are complete.
        // For sum or count detectors, short buckets would hold smaller values, and model bounds would also be affected
        // to some extent with all detector functions if not searching complete buckets.
        const searchBounds = getBoundsRoundedToInterval(
          bounds,
          stateUpdate.contextAggregationInterval,
          false
        );

        // Query 1 - load metric data at low granularity across full time range.
        // Pass a counter flag into the finish() function to make sure we only process the results
        // for the most recent call to the load the data in cases where the job selection and time filter
        // have been altered in quick succession (such as from the job picker with 'Apply time range').
        const counter = loadCounter;
        this.mlTimeSeriesSearchService
          .getMetricData(
            selectedJob,
            detectorIndex,
            nonBlankEntities,
            searchBounds.min.valueOf(),
            searchBounds.max.valueOf(),
            stateUpdate.contextAggregationInterval.asMilliseconds(),
            functionToPlotByIfMetric
          )
          .toPromise()
          .then((resp) => {
            const fullRangeChartData = this.mlTimeSeriesExplorer.processMetricPlotResults(
              resp.results,
              modelPlotEnabled
            );
            stateUpdate.contextChartData = fullRangeChartData;
            finish(counter);
          })
          .catch((err) => {
            const errorMsg = i18n.translate('xpack.ml.timeSeriesExplorer.metricDataErrorMessage', {
              defaultMessage: 'Error getting metric data',
            });
            this.displayErrorToastMessages(err, errorMsg);
          });

        // Query 2 - load max record score at same granularity as context chart
        // across full time range for use in the swimlane.
        this.mlResultsService
          .getRecordMaxScoreByTime(
            selectedJob.job_id,
            this.getCriteriaFields(detectorIndex, entityControls),
            searchBounds.min.valueOf(),
            searchBounds.max.valueOf(),
            stateUpdate.contextAggregationInterval.asMilliseconds(),
            functionToPlotByIfMetric
          )
          .then((resp) => {
            const fullRangeRecordScoreData = this.mlTimeSeriesExplorer.processRecordScoreResults(
              resp.results
            );
            stateUpdate.swimlaneData = fullRangeRecordScoreData;
            finish(counter);
          })
          .catch((err) => {
            const errorMsg = i18n.translate(
              'xpack.ml.timeSeriesExplorer.bucketAnomalyScoresErrorMessage',
              {
                defaultMessage: 'Error getting bucket anomaly scores',
              }
            );

            this.displayErrorToastMessages(err, errorMsg);
          });

        // Query 3 - load details on the chart used in the chart title (charting function and entity(s)).
        this.mlTimeSeriesSearchService
          .getChartDetails(
            selectedJob,
            detectorIndex,
            entityControls,
            searchBounds.min.valueOf(),
            searchBounds.max.valueOf(),
            this.props.functionDescription
          )
          .then((resp) => {
            stateUpdate.chartDetails = resp.results;
            finish(counter);
          })
          .catch((err) => {
            this.displayErrorToastMessages(
              err,
              i18n.translate('xpack.ml.timeSeriesExplorer.entityCountsErrorMessage', {
                defaultMessage: 'Error getting entity counts',
              })
            );
          });

        // Plus query for forecast data if there is a forecastId stored in the appState.
        if (selectedForecastId !== undefined) {
          awaitingCount++;
          let aggType = undefined;
          const detector = selectedJob.analysis_config.detectors[detectorIndex];
          const esAgg = mlFunctionToESAggregation(detector.function);
          if (modelPlotEnabled === false && (esAgg === 'sum' || esAgg === 'count')) {
            aggType = { avg: 'sum', max: 'sum', min: 'sum' };
          }
          this.mlForecastService
            .getForecastData(
              selectedJob,
              detectorIndex,
              selectedForecastId,
              nonBlankEntities,
              searchBounds.min.valueOf(),
              searchBounds.max.valueOf(),
              stateUpdate.contextAggregationInterval.asMilliseconds(),
              aggType
            )
            .toPromise()
            .then((resp) => {
              stateUpdate.contextForecastData = this.mlTimeSeriesExplorer.processForecastResults(
                resp.results
              );
              finish(counter);
            })
            .catch((err) => {
              this.displayErrorToastMessages(
                err,
                i18n.translate('xpack.ml.timeSeriesExplorer.forecastDataErrorMessage', {
                  defaultMessage: 'Error loading forecast data for forecast ID {forecastId}',
                  values: { forecastId: selectedForecastId },
                })
              );
            });
        }
      }
    );
  };

  /**
   * Updates local state of detector related controls from the global state.
   * @param callback to invoke after a state update.
   */
  getControlsForDetector = () => {
    const { selectedDetectorIndex, selectedEntities, selectedJobId } = this.props;
    const selectedJob = this.mlJobService.getJob(selectedJobId);
    return getControlsForDetector(selectedDetectorIndex, selectedEntities, selectedJob);
  };

  /**
   * Updates criteria fields for API calls, e.g. getAnomaliesTableData
   * @param detectorIndex
   * @param entities
   */
  getCriteriaFields(detectorIndex, entities) {
    // Only filter on the entity if the field has a value.
    const nonBlankEntities = entities.filter((entity) => entity.fieldValue !== null);
    return [
      {
        fieldName: 'detector_index',
        fieldValue: detectorIndex,
      },
      ...nonBlankEntities,
    ];
  }

  loadForJobId(jobId) {
    const { appStateHandler, selectedDetectorIndex } = this.props;

    const selectedJob = this.mlJobService.getJob(jobId);

    if (selectedJob === undefined) {
      return;
    }

    const detectors = getViewableDetectors(selectedJob);

    // Check the supplied index is valid.
    const appStateDtrIdx = selectedDetectorIndex;
    let detectorIndex = appStateDtrIdx !== undefined ? appStateDtrIdx : detectors[0].index;
    if (find(detectors, { index: detectorIndex }) === undefined) {
      const warningText = i18n.translate(
        'xpack.ml.timeSeriesExplorer.requestedDetectorIndexNotValidWarningMessage',
        {
          defaultMessage: 'Requested detector index {detectorIndex} is not valid for job {jobId}',
          values: {
            detectorIndex,
            jobId: selectedJob.job_id,
          },
        }
      );
      if (this.toastNotificationService) {
        this.toastNotificationService.displayWarningToast(warningText);
      }

      detectorIndex = detectors[0].index;
    }

    const detectorId = detectorIndex;

    if (detectorId !== selectedDetectorIndex) {
      appStateHandler(APP_STATE_ACTION.SET_DETECTOR_INDEX, detectorId);
    }
    // Populate the map of jobs / detectors / field formatters for the selected IDs and refresh.
    this.context.services.mlServices.mlFieldFormatService.populateFormats([jobId]);
  }

  componentDidMount() {
    const mlJobService = this.mlJobService;
    // if timeRange used in the url is incorrect
    // perhaps due to user's advanced setting using incorrect date-maths
    const { invalidTimeRangeError } = this.props;
    if (invalidTimeRangeError) {
      if (this.toastNotificationService) {
        this.toastNotificationService.displayWarningToast(
          i18n.translate('xpack.ml.timeSeriesExplorer.invalidTimeRangeInUrlCallout', {
            defaultMessage:
              'The time filter was changed to the full range for this job due to an invalid default time filter. Check the advanced settings for {field}.',
            values: {
              field: ANOMALY_DETECTION_DEFAULT_TIME_RANGE,
            },
          })
        );
      }
    }
    // Required to redraw the time series chart when the container is resized.
    this.resizeChecker = new ResizeChecker(this.resizeRef.current);
    this.resizeChecker.on('resize', () => {
      this.resizeHandler();
    });
    this.resizeHandler();

    // Listen for context chart updates.
    this.subscriptions.add(
      this.contextChart$
        .pipe(
          tap((selection) => {
            this.setState({
              zoomFrom: selection.from,
              zoomTo: selection.to,
            });
          }),
          debounceTime(500),
          tap((selection) => {
            const {
              contextChartData,
              contextForecastData,
              focusChartData,
              zoomFromFocusLoaded,
              zoomToFocusLoaded,
            } = this.state;

            if (
              (contextChartData === undefined || contextChartData.length === 0) &&
              (contextForecastData === undefined || contextForecastData.length === 0)
            ) {
              return;
            }

            if (
              (this.contextChartSelectedInitCallDone === false && focusChartData === undefined) ||
              zoomFromFocusLoaded.getTime() !== selection.from.getTime() ||
              zoomToFocusLoaded.getTime() !== selection.to.getTime()
            ) {
              this.contextChartSelectedInitCallDone = true;

              this.setState({
                loading: true,
                fullRefresh: false,
              });
            }
          }),
          switchMap((selection) => {
            const { selectedJobId } = this.props;
            const selectedJob = mlJobService.getJob(selectedJobId);

            // Calculate the aggregation interval for the focus chart.
            const bounds = { min: moment(selection.from), max: moment(selection.to) };
            const focusAggregationInterval = this.mlTimeSeriesExplorer.calculateAggregationInterval(
              bounds,
              CHARTS_POINT_TARGET,
              selectedJob
            );

            // Ensure the search bounds align to the bucketing interval so that the first and last buckets are complete.
            // For sum or count detectors, short buckets would hold smaller values, and model bounds would also be affected
            // to some extent with all detector functions if not searching complete buckets.
            const searchBounds = getBoundsRoundedToInterval(
              bounds,
              focusAggregationInterval,
              false
            );
            return forkJoin([
              this.getFocusData(selection),
              // Load the data for the anomalies table.
              this.loadAnomaliesTableData(searchBounds.min.valueOf(), searchBounds.max.valueOf()),
            ]);
          }),
          withLatestFrom(this.contextChart$)
        )
        .subscribe(([[refreshFocusData, tableData], selection]) => {
          const { modelPlotEnabled } = this.state;

          // All the data is ready now for a state update.
          this.setState({
            focusAggregationInterval: this.getFocusAggregationInterval({
              from: selection.from,
              to: selection.to,
            }),
            loading: false,
            showModelBoundsCheckbox: modelPlotEnabled && refreshFocusData.focusChartData.length > 0,
            zoomFromFocusLoaded: selection.from,
            zoomToFocusLoaded: selection.to,
            ...refreshFocusData,
            ...tableData,
          });
        })
    );

    this.componentDidUpdate();
  }

  componentDidUpdate(previousProps) {
    if (previousProps === undefined || previousProps.selectedJobId !== this.props.selectedJobId) {
      const selectedJob = this.mlJobService.getJob(this.props.selectedJobId);
      this.contextChartSelectedInitCallDone = false;
      getDataViewsAndIndicesWithGeoFields([selectedJob], this.dataViewsService, this.mlIndexUtils)
        .then(({ getSourceIndicesWithGeoFieldsResp }) =>
          this.setState(
            {
              fullRefresh: false,
              loading: true,
              sourceIndicesWithGeoFields: getSourceIndicesWithGeoFieldsResp,
            },
            () => {
              this.loadForJobId(this.props.selectedJobId);
            }
          )
        )
        .catch(console.error); // eslint-disable-line no-console
    }

    if (
      previousProps === undefined ||
      previousProps.selectedForecastId !== this.props.selectedForecastId
    ) {
      if (this.props.selectedForecastId !== undefined) {
        // Ensure the forecast data will be shown if hidden previously.
        this.setState({ showForecast: true });
        // Not best practice but we need the previous value for another comparison
        // once all the data was loaded.
        if (previousProps !== undefined) {
          this.previousSelectedForecastId = previousProps.selectedForecastId;
        }
      }
    }

    if (
      previousProps === undefined ||
      !isEqual(previousProps.bounds, this.props.bounds) ||
      (!isEqual(previousProps.lastRefresh, this.props.lastRefresh) &&
        previousProps.lastRefresh !== 0) ||
      !isEqual(previousProps.selectedDetectorIndex, this.props.selectedDetectorIndex) ||
      !isEqual(previousProps.selectedEntities, this.props.selectedEntities) ||
      previousProps.selectedForecastId !== this.props.selectedForecastId ||
      previousProps.selectedJobId !== this.props.selectedJobId ||
      previousProps.functionDescription !== this.props.functionDescription
    ) {
      const fullRefresh =
        previousProps === undefined ||
        !isEqual(previousProps.bounds, this.props.bounds) ||
        !isEqual(previousProps.selectedDetectorIndex, this.props.selectedDetectorIndex) ||
        !isEqual(previousProps.selectedEntities, this.props.selectedEntities) ||
        previousProps.selectedForecastId !== this.props.selectedForecastId ||
        previousProps.selectedJobId !== this.props.selectedJobId ||
        previousProps.functionDescription !== this.props.functionDescription;
      this.loadSingleMetricData(fullRefresh);
    }

    if (previousProps === undefined) {
      return;
    }

    // Reload the anomalies table if the Interval or Threshold controls are changed.
    const tableControlsListener = () => {
      const { zoomFrom, zoomTo } = this.state;
      if (zoomFrom !== undefined && zoomTo !== undefined) {
        this.loadAnomaliesTableData(zoomFrom.getTime(), zoomTo.getTime()).subscribe((res) =>
          this.setState(res)
        );
      }
    };

    if (
      previousProps.tableInterval !== this.props.tableInterval ||
      previousProps.tableSeverity !== this.props.tableSeverity
    ) {
      tableControlsListener();
    }
  }

  componentWillUnmount() {
    this.subscriptions.unsubscribe();
    this.resizeChecker.destroy();
    this.unmounted = true;
  }

  render() {
    const mlJobService = this.mlJobService;
    const {
      autoZoomDuration,
      bounds,
      dateFormatTz,
      lastRefresh,
      selectedDetectorIndex,
      selectedEntities,
      selectedJobId,
    } = this.props;

    const {
      chartDetails,
      contextAggregationInterval,
      contextChartData,
      contextForecastData,
      dataNotChartable,
      focusAggregationInterval,
      focusAnnotationError,
      focusAnnotationData,
      focusChartData,
      focusForecastData,
      fullRefresh,
      hasResults,
      loading,
      modelPlotEnabled,
      showAnnotations,
      showAnnotationsCheckbox,
      showForecast,
      showForecastCheckbox,
      showModelBounds,
      showModelBoundsCheckbox,
      svgWidth,
      swimlaneData,
      tableData,
      zoomFrom,
      zoomTo,
      zoomFromFocusLoaded,
      zoomToFocusLoaded,
      chartDataError,
      sourceIndicesWithGeoFields,
    } = this.state;
    const chartProps = {
      modelPlotEnabled,
      contextChartData,
      contextChartSelected: this.contextChartSelected,
      contextForecastData,
      contextAggregationInterval,
      swimlaneData,
      focusAnnotationData,
      focusChartData,
      focusForecastData,
      focusAggregationInterval,
      svgWidth,
      zoomFrom,
      zoomTo,
      zoomFromFocusLoaded,
      zoomToFocusLoaded,
      autoZoomDuration,
    };
    const jobs = mlJobService.jobs.filter(isTimeSeriesViewJob);

    if (selectedDetectorIndex === undefined || mlJobService.getJob(selectedJobId) === undefined) {
      return (
        <TimeSeriesExplorerPage
          handleJobSelectionChange={this.props.handleJobSelectionChange}
          dateFormatTz={dateFormatTz}
          resizeRef={this.resizeRef}
        >
          <ExplorerNoJobsSelected />
        </TimeSeriesExplorerPage>
      );
    }

    const selectedJob = mlJobService.getJob(selectedJobId);
    const entityControls = this.getControlsForDetector();
    const fieldNamesWithEmptyValues = this.getFieldNamesWithEmptyValues();
    const arePartitioningFieldsProvided = this.arePartitioningFieldsProvided();
    const detectors = getViewableDetectors(selectedJob);

    let renderFocusChartOnly = true;

    if (
      isEqual(this.previousChartProps.focusForecastData, chartProps.focusForecastData) &&
      isEqual(this.previousChartProps.focusChartData, chartProps.focusChartData) &&
      isEqual(this.previousChartProps.focusAnnotationData, chartProps.focusAnnotationData) &&
      this.previousShowForecast === showForecast &&
      this.previousShowModelBounds === showModelBounds &&
      this.props.previousRefresh === lastRefresh
    ) {
      renderFocusChartOnly = false;
    }

    this.previousChartProps = chartProps;
    this.previousShowForecast = showForecast;
    this.previousShowModelBounds = showModelBounds;

    return (
      <TimeSeriesExplorerPage
        dateFormatTz={dateFormatTz}
        resizeRef={this.resizeRef}
        handleJobSelectionChange={this.props.handleJobSelectionChange}
        selectedJobId={[selectedJobId]}
      >
        {fieldNamesWithEmptyValues.length > 0 && (
          <>
            <EuiCallOut
              title={
                <FormattedMessage
                  id="xpack.ml.timeSeriesExplorer.singleMetricRequiredMessage"
                  defaultMessage="To view a single metric, select {missingValuesCount, plural, one {a value for {fieldName1}} other {values for {fieldName1} and {fieldName2}}}."
                  values={{
                    missingValuesCount: fieldNamesWithEmptyValues.length,
                    fieldName1: fieldNamesWithEmptyValues[0],
                    fieldName2: fieldNamesWithEmptyValues[1],
                  }}
                />
              }
              iconType="question"
              size="s"
            />
            <EuiSpacer size="m" />
          </>
        )}
        <SeriesControls
          selectedJobId={selectedJobId}
          appStateHandler={this.props.appStateHandler}
          selectedDetectorIndex={selectedDetectorIndex}
          selectedEntities={this.props.selectedEntities}
          bounds={bounds}
          functionDescription={this.props.functionDescription}
          setFunctionDescription={this.setFunctionDescription}
        >
          {arePartitioningFieldsProvided && (
            <EuiFlexItem>
              <TimeSeriesExplorerControls
                forecastId={this.props.selectedForecastId}
                selectedDetectorIndex={selectedDetectorIndex}
                selectedEntities={selectedEntities}
                selectedJob={selectedJob}
                showAnnotationsCheckbox={showAnnotationsCheckbox}
                showAnnotations={showAnnotations}
                showForecastCheckbox={showForecastCheckbox}
                showForecast={showForecast}
                showModelBoundsCheckbox={showModelBoundsCheckbox}
                showModelBounds={showModelBounds}
                onShowModelBoundsChange={this.toggleShowModelBoundsHandler}
                onShowAnnotationsChange={this.toggleShowAnnotationsHandler}
                onShowForecastChange={this.toggleShowForecastHandler}
                fullRefresh={fullRefresh}
                loading={loading}
                hasResults={hasResults}
                setForecastId={this.setForecastId}
                entities={entityControls}
                jobs={jobs}
                selectedJobId={selectedJobId}
                // It seems like props below can be easily extracted from the selectedJob
                // However, it seems like we are losing sync at some point and they need to be passed directly
                jobState={selectedJob.state}
                earliestRecordTimestamp={selectedJob.data_counts.earliest_record_timestamp}
                latestRecordTimestamp={selectedJob.data_counts.latest_record_timestamp}
              />
            </EuiFlexItem>
          )}
        </SeriesControls>
        <EuiSpacer size="m" />

        {fullRefresh && loading === true && (
          <LoadingIndicator
            label={i18n.translate('xpack.ml.timeSeriesExplorer.loadingLabel', {
              defaultMessage: 'Loading',
            })}
          />
        )}

        {loading === false && chartDataError !== undefined && (
          <TimeseriesexplorerChartDataError errorMsg={chartDataError} />
        )}

        {arePartitioningFieldsProvided &&
          jobs.length > 0 &&
          (fullRefresh === false || loading === false) &&
          hasResults === false &&
          chartDataError === undefined && (
            <TimeseriesexplorerNoChartData
              dataNotChartable={dataNotChartable}
              entities={entityControls}
            />
          )}
        {arePartitioningFieldsProvided &&
          jobs.length > 0 &&
          (fullRefresh === false || loading === false) &&
          hasResults === true && (
            <div>
              <EuiFlexGroup gutterSize="xs" alignItems="center">
                <EuiFlexItem grow={false}>
                  <EuiTitle size={'xs'}>
                    <h2>
                      <span>
                        {i18n.translate(
                          'xpack.ml.timeSeriesExplorer.singleTimeSeriesAnalysisTitle',
                          {
                            defaultMessage: 'Single time series analysis of {functionLabel}',
                            values: { functionLabel: chartDetails.functionLabel },
                          }
                        )}
                      </span>
                      &nbsp;
                      {chartDetails.entityData.count === 1 &&
                        chartDetails.entityData.entities.length > 0 && (
                          <EuiTextColor color="accentSecondary" size="s" component="span">
                            (
                            {chartDetails.entityData.entities
                              .map((entity) => {
                                return `${entity.fieldName}: ${entity.fieldValue}`;
                              })
                              .join(', ')}
                            )
                          </EuiTextColor>
                        )}
                      {chartDetails.entityData.count > 1 && (
                        <EuiTextColor color="accentSecondary" size="s" component="span">
                          {chartDetails.entityData.entities.map((countData, i) => {
                            return (
                              <Fragment key={countData.fieldName}>
                                {i18n.translate(
                                  'xpack.ml.timeSeriesExplorer.countDataInChartDetailsDescription',
                                  {
                                    defaultMessage:
                                      '{openBrace}{cardinalityValue} distinct {fieldName} {cardinality, plural, one {} other { values}}{closeBrace}',
                                    values: {
                                      openBrace: i === 0 ? '(' : '',
                                      closeBrace:
                                        i === chartDetails.entityData.entities.length - 1
                                          ? ')'
                                          : '',
                                      cardinalityValue:
                                        countData.cardinality === 0
                                          ? allValuesLabel
                                          : countData.cardinality,
                                      cardinality: countData.cardinality,
                                      fieldName: countData.fieldName,
                                    },
                                  }
                                )}
                                {i !== chartDetails.entityData.entities.length - 1 ? ', ' : ''}
                              </Fragment>
                            );
                          })}
                        </EuiTextColor>
                      )}
                    </h2>
                  </EuiTitle>
                </EuiFlexItem>

                <EuiFlexItem grow={false}>
                  <TimeSeriesExplorerHelpPopover />
                </EuiFlexItem>
              </EuiFlexGroup>

              <TimeSeriesChartWithTooltips
                chartProps={chartProps}
                contextAggregationInterval={contextAggregationInterval}
                bounds={bounds}
                detectorIndex={selectedDetectorIndex}
                renderFocusChartOnly={renderFocusChartOnly}
                selectedJob={selectedJob}
                selectedEntities={this.props.selectedEntities}
                showAnnotations={showAnnotations}
                showForecast={showForecast}
                showModelBounds={showModelBounds}
                lastRefresh={lastRefresh}
                tableData={tableData}
                sourceIndicesWithGeoFields={sourceIndicesWithGeoFields}
              />
              {focusAnnotationError !== undefined && (
                <>
                  <EuiTitle data-test-subj="mlAnomalyExplorerAnnotations error" size={'xs'}>
                    <h2>
                      <FormattedMessage
                        id="xpack.ml.timeSeriesExplorer.annotationsErrorTitle"
                        defaultMessage="Annotations"
                      />
                    </h2>
                  </EuiTitle>
                  <EuiPanel>
                    <EuiCallOut
                      title={i18n.translate(
                        'xpack.ml.timeSeriesExplorer.annotationsErrorCallOutTitle',
                        {
                          defaultMessage: 'An error occurred loading annotations:',
                        }
                      )}
                      color="danger"
                      iconType="warning"
                    >
                      <p>{focusAnnotationError}</p>
                    </EuiCallOut>
                  </EuiPanel>
                  <EuiSpacer size="m" />
                </>
              )}
              {focusAnnotationData && focusAnnotationData.length > 0 && (
                <>
                  <EuiAccordion
                    id={'mlAnnotationsAccordion'}
                    buttonContent={
                      <EuiTitle size={'xs'}>
                        <h2>
                          <FormattedMessage
                            id="xpack.ml.timeSeriesExplorer.annotationsTitle"
                            defaultMessage="Annotations {badge}"
                            values={{
                              badge: (
                                <EuiBadge color={'hollow'}>
                                  <FormattedMessage
                                    id="xpack.ml.explorer.annotationsTitleTotalCount"
                                    defaultMessage="Total: {count}"
                                    values={{ count: focusAnnotationData.length }}
                                  />
                                </EuiBadge>
                              ),
                            }}
                          />
                        </h2>
                      </EuiTitle>
                    }
                    data-test-subj="mlAnomalyExplorerAnnotations loaded"
                  >
                    <AnnotationsTable
                      chartDetails={chartDetails}
                      detectorIndex={selectedDetectorIndex}
                      detectors={detectors}
                      jobIds={[this.props.selectedJobId]}
                      annotations={focusAnnotationData}
                      isSingleMetricViewerLinkVisible={false}
                      isNumberBadgeVisible={true}
                    />
                  </EuiAccordion>
                  <EuiSpacer size="m" />
                </>
              )}
              <AnnotationFlyout
                chartDetails={chartDetails}
                detectorIndex={selectedDetectorIndex}
                detectors={detectors}
              />
              <EuiTitle size={'xs'}>
                <h2>
                  <FormattedMessage
                    id="xpack.ml.timeSeriesExplorer.anomaliesTitle"
                    defaultMessage="Anomalies"
                  />
                </h2>
              </EuiTitle>
              <EuiSpacer size="s" />
              <EuiFlexGroup direction="row" gutterSize="l" responsive={true}>
                <EuiFlexItem grow={false}>
                  <SelectSeverity />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <SelectInterval />
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiSpacer size="m" />
            </div>
          )}
        {arePartitioningFieldsProvided &&
          jobs.length > 0 &&
          hasResults === true &&
          tableData?.anomalies && (
            <AnomaliesTable
              bounds={bounds}
              tableData={tableData}
              filter={this.tableFilter}
              sourceIndicesWithGeoFields={this.state.sourceIndicesWithGeoFields}
              selectedJobs={[
                {
                  id: selectedJob.job_id,
                  modelPlotEnabled,
                },
              ]}
            />
          )}
      </TimeSeriesExplorerPage>
    );
  }
}
