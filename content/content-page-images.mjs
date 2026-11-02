export const contentPageImageGroups = [
  {
    asset: 'content-guide-showroom.png',
    alt: 'Guests comparing mattresses during a calm guided showroom visit',
    handles: [
      'building-your-snoozepod',
      'what-is-a-snoozepod',
      'how-the-mysnoozepod-showroom-works',
      'what-is-a-snooze-session',
      'what-to-expect-during-your-snooze-session',
      'how-to-prepare-for-your-showroom-visit',
      'what-happens-after-your-snooze-session',
      'comparing-sleep-systems-without-sales-pressure',
      'from-showroom-recommendation-to-home-delivery',
    ],
  },
  {
    asset: 'content-guide-virtual-session.png',
    alt: 'A virtual sleep consultation taking place in a comfortable bedroom',
    handles: ['how-a-virtual-snooze-session-works'],
  },
  {
    asset: 'content-guide-sleep-system.png',
    alt: 'A coordinated mattress, pillows, sheets, comforter, and bedroom foundation',
    handles: [
      'what-makes-a-complete-sleep-system',
      'how-your-sleep-system-components-work-together',
      'how-to-choose-the-right-mattress',
      'how-to-choose-the-right-mattress-size',
      'showroom-comfort-vs-ordered-configuration',
      'questions-to-ask-before-buying-a-mattress',
      'when-is-it-time-to-replace-your-mattress',
    ],
  },
  {
    asset: 'content-guide-comfort-comparison.png',
    alt: 'Shoppers comparing different mattress comfort choices in a relaxed showroom',
    handles: [
      'understanding-mattress-comfort-soft-to-firm',
      'mattress-support-vs-mattress-firmness',
      'understanding-pressure-relief-and-body-alignment',
      'choosing-a-mattress-for-side-back-or-combination-sleep',
    ],
  },
  {
    asset: 'content-guide-dual-comfort.png',
    alt: 'A couple independently testing comfort on each side of one mattress',
    handles: [
      'benefits-of-dual-comfort-mattresses',
      'how-independent-left-and-right-comfort-works',
      'choosing-between-soft-medium-soft-medium-firm-and-firm',
      'choosing-different-comfort-levels-as-a-couple',
      'what-happens-when-partners-have-different-sleep-preferences',
      'choosing-comfort-for-each-side-of-the-bed',
      'who-is-a-dual-comfort-mattress-for',
      'choosing-a-mattress-for-couples-with-different-sleep-styles',
    ],
  },
  {
    asset: 'content-guide-split-system.png',
    alt: 'A split-head sleep system demonstrating independent upper-body positioning',
    handles: [
      'standard-split-head-half-split-and-full-split-explained',
      'is-a-split-head-mattress-right-for-you',
      'understanding-split-head-adjustable-sleep-systems',
    ],
  },
  {
    asset: 'content-guide-mattress-materials.png',
    alt: 'Unbranded foam, pocketed coil, textile, and fiber mattress material samples',
    handles: [
      'memory-foam-vs-hybrid-mattresses',
      'understanding-modular-mattresses',
      'choosing-a-foam-mattress',
      'choosing-a-hybrid-mattress',
      'comparing-mattress-types',
      'how-mattress-materials-affect-comfort',
    ],
  },
  {
    asset: 'content-guide-cooling.png',
    alt: 'An airy bedroom arranged with lightweight bedding for a cooler sleep environment',
    handles: [
      'cooling-mattresses-what-actually-matters',
      'creating-a-cooler-more-comfortable-sleep-environment',
      'choosing-the-right-comforter-weight',
    ],
  },
  {
    asset: 'content-guide-adjustable-base.png',
    alt: 'An adjustable bed positioned with the head and knees comfortably elevated',
    handles: [
      'benefits-of-an-adjustable-base',
      'adjustable-base-features-explained',
      'how-to-choose-an-adjustable-base',
      'understanding-zero-gravity-and-preset-positions',
      'how-to-match-a-mattress-with-an-adjustable-base',
      'adjustable-bases-vs-platform-bases',
    ],
  },
  {
    asset: 'content-guide-bedding-essentials.png',
    alt: 'Coordinated pillows, sheets, mattress protection, and comforter layers',
    handles: [
      'how-to-find-the-right-pillow',
      'how-mattress-protectors-help-protect-your-bed',
      'choosing-sheets-for-standard-and-split-head-mattresses',
    ],
  },
];

export const contentPageImages = new Map(
  contentPageImageGroups.flatMap((group) => group.handles.map((handle) => [handle, { asset: group.asset, alt: group.alt }])),
);
