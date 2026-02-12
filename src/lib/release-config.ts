export type ReleaseSlug = 'main' | 'ulmo' | 'teak' | 'sumac';

export type ReleaseOption = {
  slug: ReleaseSlug;
  label: string;
  basePath: string;
};

export const releaseOptions: ReleaseOption[] = [
  {
    slug: 'main',
    label: 'Main',
    basePath: '/openedx-plugin-slots-browser',
  },
  {
    slug: 'ulmo',
    label: 'Ulmo',
    basePath: '/openedx-plugin-slots-browser/releases/ulmo',
  },
  {
    slug: 'teak',
    label: 'Teak',
    basePath: '/openedx-plugin-slots-browser/releases/teak',
  },
  {
    slug: 'sumac',
    label: 'Sumac',
    basePath: '/openedx-plugin-slots-browser/releases/sumac',
  },
];

export const releaseSlugs = releaseOptions
  .filter((option) => option.slug !== 'main')
  .map((option) => option.slug);

export const getReleaseOption = (slug?: string): ReleaseOption => {
  if (!slug) {
    return releaseOptions[0];
  }
  const match = releaseOptions.find((option) => option.slug === slug);
  return match ?? releaseOptions[0];
};
