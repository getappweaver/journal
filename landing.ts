import type { PluginLandingDefinition } from '../../apps/landing/content-types';

export const landingPage: PluginLandingDefinition = {
  route: '/apps/captains-log',
  name: "Captain's Log",
  shortName: 'Journal',
  description:
    'Capture private notes, search entries, and publish deliberately.',
  features: [
    "Capture private workspace notes as a local Captain's Log.",
    'Stroll through entries like a real notepad instead of treating every note as a search result.',
    'Publish selected logs only after reviewing the exact draft.',
  ],
  hasInteractiveDemo: true,
  installScreenshot: 'landing/assets/captains-log.png',
  assetAliases: [
    {
      source: 'landing/assets/overview.png',
      publicPath: '/screenshots/journal.png',
    },
  ],
  demoStories: [],
  presentation: null,
  roadmapRepoId: 'journal',
};
