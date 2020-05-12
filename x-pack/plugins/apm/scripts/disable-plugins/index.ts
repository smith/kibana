/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { findKibanaPlatformPlugins } from '@kbn/optimizer/target/optimizer/kibana_platform_plugins';
import * as Path from 'path';
import { flatten, snakeCase } from 'lodash';
import { readFileSync } from 'fs';

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

function deps(id: string) {
  const requiredPlugins = pluginMap[id].requiredPlugins ?? [];
  const optionalPlugins = pluginMap[id].optionalPlugins ?? [];
  return [
    ...new Set(
      flatten([
        ...requiredPlugins,
        ...optionalPlugins,
        ...requiredPlugins.map(rid => deps(rid)),
        ...optionalPlugins.map(oid => deps(oid))
      ])
    )
  ];
}

const repoRoot = __dirname + '/../../../../..';
const pluginScanDirs = [
  Path.resolve(repoRoot, 'src/plugins'),
  Path.resolve(repoRoot, 'x-pack/plugins'),
  Path.resolve(repoRoot, 'x-pack/legacy/plugins'),
  Path.resolve(repoRoot, 'src/legay/core_plugins'),
  Path.resolve(repoRoot, 'plugins')
];

const pluginList = findKibanaPlatformPlugins(pluginScanDirs, []);

// These either fail when you try to do .enabled: false, or make kibana fail to
// start. Exclude them.
const exclude = [
  'features',
  'home',
  'kibanaLegacy',
  'licensing',
  'mapsLegacy',
  'regionMap',
  'testbed',
  'tileMap',
  'usageCollection'
];

// These have an incorrect configPath so we alias it
const aliases = {
  'xpack.reporting': 'reporting'
};

const kibanaJsons = pluginList.map(plugin => {
  const kibanaJson = JSON.parse(
    readFileSync(`${plugin.directory}/kibana.json`)
  );
  const key = kibanaJson.configPath?.join('.');
  const configKey = aliases[key] ?? key ?? snakeCase(plugin.id);
  return {
    ...plugin,
    ...kibanaJson,
    configKey
  };
});

const pluginMap = kibanaJsons.reduce((acc, plugin) => {
  acc[plugin.id] = plugin;
  return acc;
}, {});

// console.log(pluginMap);
// //process.exit(0);

const allDisabledPlugins = Object.values(pluginMap)
  .filter(plugin => !exclude.includes(plugin.id))
  .map(plugin => plugin.id);

// console.log(allDisabledPlugins);
// process.exit(0);

//console.log(deps('apm'));
const toEnable = ['apm', ...deps('apm')];

// If I leave out everything that has a configpath, we can get it to start
// using the first set of excludes, but there's still some other things enabled
// that probably shouldn't be.
//
// If I disable everything, including the second two sets of excludes, it
// won't start because too many things are disabled.
//
// The correct solution would be to walk the tree so everything gets selected
// correctly.

const disabledPlugins = allDisabledPlugins.filter(id => !toEnable.includes(id));

disabledPlugins.forEach(id =>
  console.log(`${pluginMap[id].configKey}.enabled: false`)
);

// TODO
// Usage:
//   --list: show the whole map
//   --except pluginId: don't disable these and their deps. Use multiple times.
