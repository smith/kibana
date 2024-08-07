/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DataLoadingState } from '@kbn/unified-data-table';
import { renderHook, act } from '@testing-library/react-hooks';
import type { TimelineArgs, UseTimelineEventsProps } from '.';
import { initSortDefault, useTimelineEvents } from '.';
import { SecurityPageName } from '../../../common/constants';
import { TimelineId } from '../../../common/types/timeline';
import { useIsExperimentalFeatureEnabled } from '../../common/hooks/use_experimental_features';
import { mockTimelineData } from '../../common/mock';
import { useRouteSpy } from '../../common/utils/route/use_route_spy';
import { useFetchNotes } from '../../notes/hooks/use_fetch_notes';

const mockDispatch = jest.fn();
jest.mock('react-redux', () => {
  const original = jest.requireActual('react-redux');

  return {
    ...original,
    useDispatch: () => mockDispatch,
  };
});

jest.mock('../../notes/hooks/use_fetch_notes');
const onLoadMock = jest.fn();
const useFetchNotesMock = useFetchNotes as jest.Mock;

const mockEvents = mockTimelineData.filter((i, index) => index <= 11);

const mockSearch = jest.fn();

jest.mock('../../common/lib/apm/use_track_http_request');
jest.mock('../../common/hooks/use_experimental_features');
const useIsExperimentalFeatureEnabledMock = useIsExperimentalFeatureEnabled as jest.Mock;

jest.mock('../../common/lib/kibana', () => ({
  useToasts: jest.fn().mockReturnValue({
    addError: jest.fn(),
    addSuccess: jest.fn(),
    addWarning: jest.fn(),
    remove: jest.fn(),
  }),
  useKibana: jest.fn().mockReturnValue({
    services: {
      application: {
        capabilities: {
          siem: {
            crud: true,
          },
        },
      },
      data: {
        search: {
          search: jest.fn().mockImplementation((args) => {
            mockSearch();
            return {
              subscribe: jest.fn().mockImplementation(({ next }) => {
                next({
                  isRunning: false,
                  isPartial: false,
                  inspect: {
                    dsl: [],
                    response: [],
                  },
                  edges: mockEvents.map((item) => ({ node: item })),
                  pageInfo: {
                    activePage: 0,
                    totalPages: 10,
                  },
                  rawResponse: {},
                  totalCount: mockTimelineData.length,
                });
                return { unsubscribe: jest.fn() };
              }),
            };
          }),
        },
      },
      notifications: {
        toasts: {
          addWarning: jest.fn(),
        },
      },
    },
  }),
}));

const mockUseRouteSpy: jest.Mock = useRouteSpy as jest.Mock;
jest.mock('../../common/utils/route/use_route_spy', () => ({
  useRouteSpy: jest.fn(),
}));

mockUseRouteSpy.mockReturnValue([
  {
    pageName: SecurityPageName.overview,
    detailName: undefined,
    tabName: undefined,
    search: '',
    pathName: '/overview',
  },
]);

describe('useTimelineEvents', () => {
  useIsExperimentalFeatureEnabledMock.mockReturnValue(false);

  beforeEach(() => {
    mockSearch.mockReset();
    useFetchNotesMock.mockClear();
    onLoadMock.mockClear();

    useFetchNotesMock.mockReturnValue({
      onLoad: onLoadMock,
    });
  });

  const startDate: string = '2020-07-07T08:20:18.966Z';
  const endDate: string = '3000-01-01T00:00:00.000Z';
  const props: UseTimelineEventsProps = {
    dataViewId: 'data-view-id',
    endDate: '',
    id: TimelineId.active,
    indexNames: ['filebeat-*'],
    fields: ['@timestamp', 'event.kind'],
    filterQuery: '',
    startDate: '',
    limit: 25,
    runtimeMappings: {},
    sort: initSortDefault,
    skip: false,
  };

  test('init', async () => {
    await act(async () => {
      const { result, waitForNextUpdate } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: { ...props },
      });

      // useEffect on params request
      await waitForNextUpdate();
      expect(result.current).toEqual([
        DataLoadingState.loaded,
        {
          events: [],
          id: TimelineId.active,
          inspect: result.current[1].inspect,
          loadPage: result.current[1].loadPage,
          pageInfo: result.current[1].pageInfo,
          refetch: result.current[1].refetch,
          totalCount: -1,
          refreshedAt: 0,
        },
      ]);
    });
  });

  test('happy path query', async () => {
    await act(async () => {
      const { result, waitForNextUpdate, rerender } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: { ...props },
      });

      // useEffect on params request
      await waitForNextUpdate();
      rerender({ ...props, startDate, endDate });
      // useEffect on params request
      await waitForNextUpdate();

      expect(mockSearch).toHaveBeenCalledTimes(2);
      expect(result.current).toEqual([
        DataLoadingState.loaded,
        {
          events: mockEvents,
          id: TimelineId.active,
          inspect: result.current[1].inspect,
          loadPage: result.current[1].loadPage,
          pageInfo: result.current[1].pageInfo,
          refetch: result.current[1].refetch,
          totalCount: 32,
          refreshedAt: result.current[1].refreshedAt,
        },
      ]);
    });
  });

  test('Mock cache for active timeline when switching page', async () => {
    await act(async () => {
      const { result, waitForNextUpdate, rerender } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: { ...props },
      });

      // useEffect on params request
      await waitForNextUpdate();
      rerender({ ...props, startDate, endDate });
      // useEffect on params request
      await waitForNextUpdate();

      mockUseRouteSpy.mockReturnValue([
        {
          pageName: SecurityPageName.timelines,
          detailName: undefined,
          tabName: undefined,
          search: '',
          pathName: '/timelines',
        },
      ]);

      expect(mockSearch).toHaveBeenCalledTimes(2);

      expect(result.current).toEqual([
        DataLoadingState.loaded,
        {
          events: mockEvents,
          id: TimelineId.active,
          inspect: result.current[1].inspect,
          loadPage: result.current[1].loadPage,
          pageInfo: result.current[1].pageInfo,
          refetch: result.current[1].refetch,
          totalCount: 32,
          refreshedAt: result.current[1].refreshedAt,
        },
      ]);
    });
  });

  test('Correlation pagination is calling search strategy when switching page', async () => {
    await act(async () => {
      const { result, waitForNextUpdate, rerender } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: {
          ...props,
          language: 'eql',
          eqlOptions: {
            eventCategoryField: 'category',
            tiebreakerField: '',
            timestampField: '@timestamp',
            query: 'find it EQL',
            size: 100,
          },
        },
      });

      // useEffect on params request
      await waitForNextUpdate();
      rerender({
        ...props,
        startDate,
        endDate,
        language: 'eql',
        eqlOptions: {
          eventCategoryField: 'category',
          tiebreakerField: '',
          timestampField: '@timestamp',
          query: 'find it EQL',
          size: 100,
        },
      });
      // useEffect on params request
      await waitForNextUpdate();
      mockSearch.mockReset();
      result.current[1].loadPage(4);
      await waitForNextUpdate();
      expect(mockSearch).toHaveBeenCalledTimes(1);
    });
  });

  test('should query again when a new field is added', async () => {
    await act(async () => {
      const { waitForNextUpdate, rerender } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: { ...props },
      });

      // useEffect on params request
      await waitForNextUpdate();
      rerender({ ...props, startDate, endDate });
      // useEffect on params request
      await waitForNextUpdate();

      expect(mockSearch).toHaveBeenCalledTimes(2);
      mockSearch.mockClear();

      rerender({
        ...props,
        startDate,
        endDate,
        fields: ['@timestamp', 'event.kind', 'event.category'],
      });

      await waitForNextUpdate();

      expect(mockSearch).toHaveBeenCalledTimes(1);
    });
  });

  test('should not query again when a field is removed', async () => {
    await act(async () => {
      const { waitForNextUpdate, rerender } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: { ...props },
      });

      // useEffect on params request
      await waitForNextUpdate();
      rerender({ ...props, startDate, endDate });
      // useEffect on params request
      await waitForNextUpdate();

      expect(mockSearch).toHaveBeenCalledTimes(2);
      mockSearch.mockClear();

      rerender({ ...props, startDate, endDate, fields: ['@timestamp'] });

      // since there is no new update in useEffect, it should throw an timeout error
      await expect(waitForNextUpdate()).rejects.toThrowError();

      expect(mockSearch).toHaveBeenCalledTimes(0);
    });
  });
  test('should not query again when a removed field is added back', async () => {
    await act(async () => {
      const { waitForNextUpdate, rerender } = renderHook<
        UseTimelineEventsProps,
        [DataLoadingState, TimelineArgs]
      >((args) => useTimelineEvents(args), {
        initialProps: { ...props },
      });

      // useEffect on params request
      await waitForNextUpdate();
      rerender({ ...props, startDate, endDate });
      // useEffect on params request
      await waitForNextUpdate();

      expect(mockSearch).toHaveBeenCalledTimes(2);
      mockSearch.mockClear();

      // remove `event.kind` from default fields
      rerender({ ...props, startDate, endDate, fields: ['@timestamp'] });

      // since there is no new update in useEffect, it should throw an timeout error
      await expect(waitForNextUpdate()).rejects.toThrowError();

      expect(mockSearch).toHaveBeenCalledTimes(0);

      // request default Fields
      rerender({ ...props, startDate, endDate });

      // since there is no new update in useEffect, it should throw an timeout error
      await expect(waitForNextUpdate()).rejects.toThrowError();

      expect(mockSearch).toHaveBeenCalledTimes(0);
    });
  });

  describe('Fetch Notes', () => {
    test('should call onLoad for notes when events are fetched', async () => {
      await act(async () => {
        const { waitFor } = renderHook<UseTimelineEventsProps, [DataLoadingState, TimelineArgs]>(
          (args) => useTimelineEvents(args),
          {
            initialProps: { ...props },
          }
        );

        await waitFor(() => {
          expect(mockSearch).toHaveBeenCalledTimes(1);
          expect(onLoadMock).toHaveBeenNthCalledWith(1, expect.objectContaining(mockEvents));
        });
      });
    });
  });
});
