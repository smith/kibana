/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import moment from 'moment';

// @ts-ignore
const zone = moment.defaultZone ? moment.defaultZone.name : moment.tz.guess();

export function getTimezoneOffsetInMs(time: number) {
  // @ts-ignore
  return moment.tz.zone(zone).parse(time) * 60000;
}
