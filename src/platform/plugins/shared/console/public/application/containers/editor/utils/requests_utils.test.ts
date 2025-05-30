/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { monaco, ParsedRequest } from '@kbn/monaco';
import type { MetricsTracker } from '../../../../types';
import {
  getAutoIndentedRequests,
  getCurlRequest,
  getRequestEndLineNumber,
  replaceRequestVariables,
  trackSentRequests,
  getRequestFromEditor,
  containsComments,
  collapseTripleQuoteStrings,
  expandTripleQuoteStrings,
  TRIPLE_QUOTE_STRINGS_MARKER,
} from './requests_utils';

describe('requests_utils', () => {
  const dataObjects = [
    {
      query: {
        match_all: {},
      },
    },
    {
      test: 'test',
    },
  ];
  const inlineData = '{"query":"test"}';
  const multiLineData = '{\n  "query": "test"\n}';
  const invalidData = '{\n  "query":\n    {';
  const getMockModel = (content: string[]) => {
    return {
      getLineContent: (lineNumber: number) => content[lineNumber - 1],
      getValueInRange: ({
        startLineNumber,
        endLineNumber,
      }: {
        startLineNumber: number;
        endLineNumber: number;
      }) => content.slice(startLineNumber - 1, endLineNumber).join('\n'),
      getLineMaxColumn: (lineNumber: number) => content[lineNumber - 1].length,
      getLineCount: () => content.length,
    } as unknown as monaco.editor.ITextModel;
  };

  describe('replaceRequestVariables', () => {
    const variables = [
      { id: '1', name: 'variable1', value: 'test1' },
      {
        id: '2',
        name: 'variable2',
        value: 'test2',
      },
      {
        id: '3',
        name: 'variable3',
        value: '{"match_all": {}}',
      },
    ];

    describe('replaces variables in the url', () => {
      const request = {
        method: 'GET',
        url: '${variable1}',
        data: [],
      };
      it('when there is no other text', () => {
        const result = replaceRequestVariables(request, variables);
        expect(result.url).toBe('test1');
      });
      it('inside a string', () => {
        const result = replaceRequestVariables(
          { ...request, url: 'test_${variable1}_test' },
          variables
        );
        expect(result.url).toBe('test_test1_test');
      });
      it('works with several variables', () => {
        const result = replaceRequestVariables(
          { ...request, url: '${variable1}_${variable2}' },
          variables
        );
        expect(result.url).toBe('test1_test2');
      });
    });

    describe('replaces variables in the request body', () => {
      const request = {
        method: 'GET',
        url: '${variable1}',
        data: [
          JSON.stringify(
            { '${variable1}': '${variable2}', '${variable2}': '${variable3}' },
            null,
            2
          ),
        ],
      };
      it('works with several variables', () => {
        const result = replaceRequestVariables(request, variables);
        expect(JSON.parse(result.data[0])).toMatchObject({
          test1: 'test2',
          test2: { match_all: {} },
        });
      });
    });
  });

  describe('getCurlRequest', () => {
    it('works without a request body', () => {
      const request = { method: 'GET', url: '_search', data: [] };
      const result = getCurlRequest(request, 'http://test.com');
      expect(result).toBe('curl -XGET "http://test.com/_search" -H "kbn-xsrf: reporting"');
    });
    it('works with a request body', () => {
      const request = {
        method: 'GET',
        url: '_search',
        data: [JSON.stringify(dataObjects[0], null, 2)],
      };
      const result = getCurlRequest(request, 'http://test.com');
      expect(result).toBe(
        'curl -XGET "http://test.com/_search" -H "kbn-xsrf: reporting" -H "Content-Type: application/json" -d\'\n' +
          '{\n' +
          '  "query": {\n' +
          '    "match_all": {}\n' +
          '  }\n' +
          "}'"
      );
    });
    it('works with several request bodies', () => {
      const request = {
        method: 'GET',
        url: '_search',
        data: [JSON.stringify(dataObjects[0], null, 2), JSON.stringify(dataObjects[1], null, 2)],
      };
      const result = getCurlRequest(request, 'http://test.com');
      expect(result).toBe(
        'curl -XGET "http://test.com/_search" -H "kbn-xsrf: reporting" -H "Content-Type: application/json" -d\'\n' +
          '{\n' +
          '  "query": {\n' +
          '    "match_all": {}\n' +
          '  }\n' +
          '}\n' +
          '{\n' +
          '  "test": "test"\n' +
          "}'"
      );
    });
  });

  describe('trackSentRequests', () => {
    it('tracks each request correctly', () => {
      const requests = [
        { method: 'GET', url: '_search', data: [] },
        { method: 'POST', url: '_test', data: [] },
      ];
      const mockMetricsTracker: jest.Mocked<MetricsTracker> = { count: jest.fn(), load: jest.fn() };
      trackSentRequests(requests, mockMetricsTracker);
      expect(mockMetricsTracker.count).toHaveBeenCalledTimes(2);
      expect(mockMetricsTracker.count).toHaveBeenNthCalledWith(1, 'GET__search');
      expect(mockMetricsTracker.count).toHaveBeenNthCalledWith(2, 'POST__test');
    });
  });

  describe('getAutoIndentedRequests', () => {
    const mockAddToastWarning = jest.fn();
    const sampleEditorTextLines = [
      '                                    ', // line 1
      'GET    _search                      ', // line 2
      '{                                   ', // line 3
      '  "query":     {                    ', // line 4
      '    "match_all":    {      }        ', // line 5
      '    }                               ', // line 6
      '   }                                ', // line 7
      '                                    ', // line 8
      '// single comment before Request 2  ', // line 9
      '  GET  _all                         ', // line 10
      '                                    ', // line 11
      '/*                                  ', // line 12
      ' multi-line comment before Request 3', // line 13
      '*/                                  ', // line 14
      'POST   /_bulk                       ', // line 15
      '{                                   ', // line 16
      '       "index":{                    ', // line 17
      '          "_index":"books"          ', // line 18
      '     }                              ', // line 19
      ' }                                  ', // line 20
      '{                                   ', // line 21
      '"name":"1984"                       ', // line 22
      '}{"name":"Atomic habits"}           ', // line 23
      '                                    ', // line 24
      'GET    _search  // test comment     ', // line 25
      '{                                   ', // line 26
      '  "query":     {                    ', // line 27
      '    "match_all":    {   } // comment', // line 28
      '    }                               ', // line 29
      '}                                   ', // line 30
      ' // some comment                    ', // line 31
      '                                    ', // line 32
      'POST    _query                     ', // line 33
      '{                                   ', // line 34
      '  "query":     """', // line 35
      '    FROM sample_data', // line 36
      '    | WHERE message LIKE "Connected *"', // line 37
      '    | SORT @timestamp DESC', // line 38
      '  """                                 ', // line 39
      '}                                   ', // line 40
    ];

    const TEST_REQUEST_1 = {
      // Offsets are with respect to the sample editor text
      startLineNumber: 2,
      endLineNumber: 7,
      startOffset: 1,
      endOffset: 36,
    };

    const TEST_REQUEST_2 = {
      // Offsets are with respect to the sample editor text
      startLineNumber: 10,
      endLineNumber: 10,
      startOffset: 1,
      endOffset: 36,
    };

    const TEST_REQUEST_3 = {
      // Offsets are with respect to the sample editor text
      startLineNumber: 15,
      endLineNumber: 23,
      startOffset: 1,
      endOffset: 36,
    };

    const TEST_REQUEST_4 = {
      // Offsets are with respect to the sample editor text
      startLineNumber: 25,
      endLineNumber: 30,
      startOffset: 1,
      endOffset: 36,
    };

    const TEST_REQUEST_5 = {
      // Offsets are with respect to the sample editor text
      startLineNumber: 33,
      endLineNumber: 40,
      startOffset: 1,
      endOffset: 36,
    };

    afterEach(() => {
      mockAddToastWarning.mockClear();
    });

    it('correctly auto-indents a single request with data', () => {
      const formattedData = getAutoIndentedRequests(
        [TEST_REQUEST_1],
        sampleEditorTextLines
          .slice(TEST_REQUEST_1.startLineNumber - 1, TEST_REQUEST_1.endLineNumber)
          .join('\n'),
        sampleEditorTextLines.join('\n'),
        mockAddToastWarning
      );
      const expectedResultLines = [
        'GET _search',
        '{',
        '  "query": {',
        '    "match_all": {}',
        '  }',
        '}',
      ];

      expect(formattedData).toBe(expectedResultLines.join('\n'));
      expect(mockAddToastWarning).not.toHaveBeenCalled();
    });

    it('correctly auto-indents a single request with no data', () => {
      const formattedData = getAutoIndentedRequests(
        [TEST_REQUEST_2],
        sampleEditorTextLines
          .slice(TEST_REQUEST_2.startLineNumber - 1, TEST_REQUEST_2.endLineNumber)
          .join('\n'),
        sampleEditorTextLines.join('\n'),
        mockAddToastWarning
      );
      const expectedResult = 'GET _all';

      expect(formattedData).toBe(expectedResult);
      expect(mockAddToastWarning).not.toHaveBeenCalled();
    });

    it('correctly auto-indents a single request with multiple data', () => {
      const formattedData = getAutoIndentedRequests(
        [TEST_REQUEST_3],
        sampleEditorTextLines
          .slice(TEST_REQUEST_3.startLineNumber - 1, TEST_REQUEST_3.endLineNumber)
          .join('\n'),
        sampleEditorTextLines.join('\n'),
        mockAddToastWarning
      );
      const expectedResultLines = [
        'POST /_bulk',
        '{',
        '  "index": {',
        '    "_index": "books"',
        '  }',
        '}',
        '{',
        '  "name": "1984"',
        '}',
        '{',
        '  "name": "Atomic habits"',
        '}',
      ];

      expect(formattedData).toBe(expectedResultLines.join('\n'));
      expect(mockAddToastWarning).not.toHaveBeenCalled();
    });

    it('auto-indents multiple request with comments in between', () => {
      const formattedData = getAutoIndentedRequests(
        [TEST_REQUEST_1, TEST_REQUEST_2, TEST_REQUEST_3],
        sampleEditorTextLines.slice(1, 23).join('\n'),
        sampleEditorTextLines.join('\n'),
        mockAddToastWarning
      );
      const expectedResultLines = [
        'GET _search',
        '{',
        '  "query": {',
        '    "match_all": {}',
        '  }',
        '}',
        '',
        '// single comment before Request 2',
        'GET _all',
        '',
        '/*',
        'multi-line comment before Request 3',
        '*/',
        'POST /_bulk',
        '{',
        '  "index": {',
        '    "_index": "books"',
        '  }',
        '}',
        '{',
        '  "name": "1984"',
        '}',
        '{',
        '  "name": "Atomic habits"',
        '}',
      ];

      expect(formattedData).toBe(expectedResultLines.join('\n'));
      expect(mockAddToastWarning).not.toHaveBeenCalled();
    });

    it(`auto-indents method line but doesn't auto-indent data with comments`, () => {
      const methodLine = sampleEditorTextLines[TEST_REQUEST_4.startLineNumber - 1];
      const dataText = sampleEditorTextLines
        .slice(TEST_REQUEST_4.startLineNumber, TEST_REQUEST_4.endLineNumber)
        .join('\n');
      const formattedData = getAutoIndentedRequests(
        [TEST_REQUEST_4],
        `${methodLine}\n${dataText}`,
        sampleEditorTextLines.join('\n'),
        mockAddToastWarning
      );

      expect(formattedData).toBe(`GET _search // test comment\n${dataText}`);
      expect(mockAddToastWarning).toHaveBeenCalledWith(
        expect.stringContaining(
          'Auto-indentation is currently not supported for requests containing comments. Please remove comments to enable formatting.'
        )
      );
      mockAddToastWarning.mockReset();
    });

    it('correctly auto-indents a single request that contains triple quotes', () => {
      const formattedData = getAutoIndentedRequests(
        [TEST_REQUEST_5],
        sampleEditorTextLines
          .slice(TEST_REQUEST_5.startLineNumber - 1, TEST_REQUEST_5.endLineNumber)
          .join('\n'),
        sampleEditorTextLines.join('\n'),
        mockAddToastWarning
      );
      const expectedResultLines = [
        'POST _query',
        '{',
        '  "query": """',
        '    FROM sample_data',
        '    | WHERE message LIKE "Connected *"',
        '    | SORT @timestamp DESC',
        '  """',
        '}',
      ];

      expect(formattedData).toBe(expectedResultLines.join('\n'));
      expect(mockAddToastWarning).not.toHaveBeenCalled();
    });
  });

  describe('getRequestEndLineNumber', () => {
    const parsedRequest: ParsedRequest = {
      startOffset: 1,
    };
    it('detects the end of the request when there is a line that starts with a method (next not parsed request)', () => {
      /*
       * Mocking the model to return these 6 lines of text
       * 1. GET /_search
       * 2. {
       * 3. empty
       * 4. empty
       * 5. POST _search
       * 6. empty
       */
      const content = ['GET /_search', '{', '', '', 'POST _search', ''];
      const model = {
        ...getMockModel(content),
        getPositionAt: () => ({ lineNumber: 1 }),
      } as unknown as monaco.editor.ITextModel;

      const result = getRequestEndLineNumber({
        parsedRequest,
        model,
        startLineNumber: 1,
      });
      expect(result).toEqual(2);
    });

    it('detects the end of the request when the text ends', () => {
      /*
       * Mocking the model to return these 4 lines of text
       * 1. GET /_search
       * 2. {
       * 3.   {
       * 4. empty
       */
      const content = ['GET _search', '{', '  {', ''];
      const model = {
        ...getMockModel(content),
        getPositionAt: () => ({ lineNumber: 1 }),
      } as unknown as monaco.editor.ITextModel;

      const result = getRequestEndLineNumber({
        parsedRequest,
        model,
        startLineNumber: 1,
      });
      expect(result).toEqual(3);
    });
  });

  describe('getRequestFromEditor', () => {
    it('cleans up any text following the url', () => {
      const content = ['GET _search // inline comment'];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 1);
      expect(request).toEqual({ method: 'GET', url: '_search', data: [] });
    });

    it(`doesn't incorrectly removes parts of url params that include whitespaces`, () => {
      const content = ['GET _search?query="test test"'];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 1);
      expect(request).toEqual({ method: 'GET', url: '_search?query="test test"', data: [] });
    });

    it(`normalizes method to upper case`, () => {
      const content = ['get _search'];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 1);
      expect(request).toEqual({ method: 'GET', url: '_search', data: [] });
    });

    it('correctly includes the request body', () => {
      const content = ['GET _search', '{', '  "query": {}', '}'];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 4);
      expect(request).toEqual({ method: 'GET', url: '_search', data: ['{\n  "query": {}\n}'] });
    });

    it('correctly handles nested braces', () => {
      const content = ['GET _search', '{', '  "query": "{a} {b}"', '}', '{', '  "query": {}', '}'];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 7);
      expect(request).toEqual({
        method: 'GET',
        url: '_search',
        data: ['{\n  "query": "{a} {b}"\n}', '{\n  "query": {}\n}'],
      });
    });

    it('works for several request bodies', () => {
      const content = ['GET _search', '{', '  "query": {}', '}', '{', '  "query": {}', '}'];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 7);
      expect(request).toEqual({
        method: 'GET',
        url: '_search',
        data: ['{\n  "query": {}\n}', '{\n  "query": {}\n}'],
      });
    });

    it('splits several json objects', () => {
      const content = ['GET _search', inlineData, ...multiLineData.split('\n'), inlineData];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 6);
      expect(request).toEqual({
        method: 'GET',
        url: '_search',
        data: [inlineData, multiLineData, inlineData],
      });
    });
    it('works for invalid json objects', () => {
      const content = ['GET _search', inlineData, ...invalidData.split('\n')];
      const model = getMockModel(content);
      const request = getRequestFromEditor(model, 1, 5);
      expect(request).toEqual({
        method: 'GET',
        url: '_search',
        data: [inlineData, invalidData],
      });
    });
  });

  describe('containsComments', () => {
    it('should return false for JSON with // and /* inside strings', () => {
      const requestData = `{
      "docs": [
        {
          "_source": {
            "trace": {
              "name": "GET /actuator/health/**"
            },
            "transaction": {
              "outcome": "success"
            }
          }
        },
        {
          "_source": {
            "vulnerability": {
              "reference": [
                "https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2020-15778"
              ]
            }
          }
        }
      ]
    }`;
      expect(containsComments(requestData)).toBe(false);
    });

    it('should return true for text with actual line comment', () => {
      const requestData = `{
      // This is a comment
      "query": { "match_all": {} }
    }`;
      expect(containsComments(requestData)).toBe(true);
    });

    it('should return true for text with actual block comment', () => {
      const requestData = `{
      /* Bulk insert */
      "index": { "_index": "test" },
      "field1": "value1"
    }`;
      expect(containsComments(requestData)).toBe(true);
    });

    it('should return false for text without any comments', () => {
      const requestData = `{
      "field": "value"
    }`;
      expect(containsComments(requestData)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(containsComments('')).toBe(false);
    });

    it('should correctly handle escaped quotes within strings', () => {
      const requestData = `{
      "field": \"value with \\\"escaped quotes\\\"\"
    }`;
      expect(containsComments(requestData)).toBe(false);
    });

    it('should return true if comment is outside of strings', () => {
      const requestData = `{
      "field": "value" // comment here
    }`;
      expect(containsComments(requestData)).toBe(true);
    });
  });

  describe('collapseTripleQuoteStrings and expandTripleQuoteStrings', () => {
    const input = `{
  "query1": """FROM sample_data | LIMIT 3""",
  "query2": """
    FROM sample_data
    | WHERE message LIKE "Connected*"
    | SORT @timestamp DESC
    """
}`;

    it('should collapse and re-expand both inline and multi-line triple-quote strings correctly', () => {
      const { collapsedTripleQuotesData, tripleQuoteStrings } = collapseTripleQuoteStrings(input);

      // Validate that both triple-quoted strings were replaced with the marker
      expect(collapsedTripleQuotesData).toBe(`{
  "query1": ${TRIPLE_QUOTE_STRINGS_MARKER},
  "query2": ${TRIPLE_QUOTE_STRINGS_MARKER}
}`);

      // Validate extracted strings match expected format
      expect(tripleQuoteStrings).toEqual([
        `"""FROM sample_data | LIMIT 3"""`,
        `"""
    FROM sample_data
    | WHERE message LIKE "Connected*"
    | SORT @timestamp DESC
    """`,
      ]);

      // Ensure re-expansion gives the original input back
      const expanded = expandTripleQuoteStrings(collapsedTripleQuotesData, tripleQuoteStrings);
      expect(expanded).toBe(input);
    });

    it('should be idempotent if run multiple times on collapsed data', () => {
      const firstCollapse = collapseTripleQuoteStrings(input);
      const secondCollapse = collapseTripleQuoteStrings(firstCollapse.collapsedTripleQuotesData);

      expect(secondCollapse.tripleQuoteStrings).toEqual([]);
      expect(secondCollapse.collapsedTripleQuotesData).toBe(
        firstCollapse.collapsedTripleQuotesData
      );
    });
  });
});
