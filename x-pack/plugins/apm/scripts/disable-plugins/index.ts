/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { findKibanaPlatformPlugins } from '@kbn/optimizer/target/optimizer/kibana_platform_plugins';
import * as Path from 'path';
import { snakeCase } from 'lodash';
/*

Problem: Starting (for front and backend) and restarting (for backend) Kibana is slow.

It gets faster the more plugins you disable, but how do I know which ones to disable? How do I even know their names? What are their dependencies? Which can I safely disable while keeping the rest of the system working.

I’d like to be able to disable all plugins except X and leave X and all of its transitive dependencies enabled.

I’d like to be able to type a command like:

node ./scripts/disable-plugins.js —only apm

And then have it spit out:

x.enabled: false
Y.enabled: false
xpack.apm.enabled: true

So I could cat it to the end of my config/kibana.dev.yml.

*/

const repoRoot = __dirname + '/../../../../..';
const pluginScanDirs = [
  Path.resolve(repoRoot, 'src/plugins'),
  Path.resolve(repoRoot, 'x-pack/plugins'),
  Path.resolve(repoRoot, 'x-pack/legacy/plugins'),
  Path.resolve(repoRoot, 'src/legay/core_plugins'),
  Path.resolve(repoRoot, 'plugins')
];
import { readFileSync } from 'fs';
const pluginList = findKibanaPlatformPlugins(pluginScanDirs, []);
const kibanaJsons = pluginList.map(plugin =>
  JSON.parse(readFileSync(`${plugin.directory}/kibana.json`))
);
const pluginMap = kibanaJsons.reduce((acc, plugin) => {
  acc[plugin.id] = plugin;
  return acc;
}, {});

const exclude = [
  'map',
  'map.regionmap',
  'map.tilemap',

  // These do not have .enabled property you can set
  'usageCollection',
  'xpack.licensing',
  'core.testbed',
  'kibana_legacy',
  'xpack.features',
  'home'
];

const aliases = {
  'xpack.reporting': 'reporting'
};

Object.values(pluginMap).forEach(plugin => {
  // If I leave out everything that has a configpath, we can get it to start
  // using the first set of excludes, but there's still some other things enabled
  // that probably shouldn't be.
  //
  // If I disable everything, including the second two sets of excludes, it
  // won't start because too many things are disabled.
  //
  // The correct solution would be to walk the tree so everything gets selected
  // correctly.
  const configPath =
    aliases[plugin.configPath?.join('.')] ??
    plugin.configPath?.join('.') ??
    snakeCase(plugin.id);
  if (!exclude.includes(configPath)) {
    console.log(configPath + '.enabled: false');
  }
});
