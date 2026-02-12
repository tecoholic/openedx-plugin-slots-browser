import mainPluginData from '../data/plugin-slots.json';
import mainFiltersData from '../data/filters.json';
import mainEventsData from '../data/events.json';

import ulmoPluginData from '../../data/releases/ulmo/plugin-slots.json';
import ulmoFiltersData from '../../data/releases/ulmo/filters.json';
import ulmoEventsData from '../../data/releases/ulmo/events.json';

import teakPluginData from '../../data/releases/teak/plugin-slots.json';
import teakFiltersData from '../../data/releases/teak/filters.json';
import teakEventsData from '../../data/releases/teak/events.json';

import sumacPluginData from '../../data/releases/sumac/plugin-slots.json';
import sumacFiltersData from '../../data/releases/sumac/filters.json';
import sumacEventsData from '../../data/releases/sumac/events.json';

import { getReleaseOption, type ReleaseOption } from './release-config';

export type ReleaseData = {
  release: ReleaseOption;
  pluginData: typeof mainPluginData;
  filtersData: typeof mainFiltersData;
  eventsData: typeof mainEventsData;
};

const dataByRelease = {
  main: {
    pluginData: mainPluginData,
    filtersData: mainFiltersData,
    eventsData: mainEventsData,
  },
  ulmo: {
    pluginData: ulmoPluginData,
    filtersData: ulmoFiltersData,
    eventsData: ulmoEventsData,
  },
  teak: {
    pluginData: teakPluginData,
    filtersData: teakFiltersData,
    eventsData: teakEventsData,
  },
  sumac: {
    pluginData: sumacPluginData,
    filtersData: sumacFiltersData,
    eventsData: sumacEventsData,
  },
} satisfies Record<string, Omit<ReleaseData, 'release'>>;

export const getReleaseData = (slug?: string): ReleaseData => {
  const release = getReleaseOption(slug);
  const data = dataByRelease[release.slug] ?? dataByRelease.main;
  return {
    release,
    ...data,
  };
};
