import { contentPages } from './shopify-content-pages.mjs';

const groupDefinitions = [
  {
    category: 'The SnoozePod Experience',
    id: 'snoozepod-experience',
    title: 'The SnoozePod Experience',
    description: 'Plan a private showroom or virtual visit and understand what happens before, during, and after a Snooze Session.',
  },
  {
    category: 'Building a Sleep System',
    id: 'building-a-sleep-system',
    title: 'Building a Sleep System',
    description: 'Start with mattress comfort, support, size, and the components that work together around the bed.',
  },
  {
    category: 'Dual Comfort and Couples',
    id: 'dual-comfort-and-couples',
    title: 'Dual Comfort and Couples',
    description: 'Compare independent comfort, partner preferences, and standard or split sleep-system geometry.',
  },
  {
    category: 'Mattress Education',
    id: 'mattress-education',
    title: 'Mattress Education',
    description: 'Learn how common mattress types, materials, cooling approaches, pressure relief, and sleep positions differ.',
  },
  {
    category: 'Adjustable Bases and Compatibility',
    id: 'adjustable-bases-and-compatibility',
    title: 'Adjustable Bases and Compatibility',
    description: 'Understand useful adjustable-base features and the compatibility questions to verify before purchasing.',
  },
  {
    category: 'Pillows, Protection, and Bedding',
    id: 'pillows-protection-and-bedding',
    title: 'Pillows, Protection, and Bedding',
    description: 'Coordinate pillows, protection, sheets, comforters, and cooling layers with the rest of the sleep system.',
  },
];

export const guideGroups = groupDefinitions.map((group) => ({
  ...group,
  pages: contentPages.filter((page) => page.category === group.category).map(({ title, handle }) => ({ title, handle })),
}));

const pageLink = (title, handle, items) => ({
  title,
  type: 'HTTP',
  url: `https://mysnoozepod.com/pages/${handle}`,
  ...(items?.length ? { items } : {}),
});

const hubAnchor = (title, id) => ({
  title,
  type: 'HTTP',
  url: `https://mysnoozepod.com/pages/sleep-guides#${id}`,
});

export const mainMenuContract = {
  handle: 'main-menu',
  title: 'Main menu',
  items: [
    {
      title: 'Mattresses', type: 'COLLECTION', collection: 'mattresses', items: [
        { title: 'Shop All Mattresses', type: 'COLLECTION', collection: 'mattresses' },
        { title: 'S7', type: 'COLLECTION', collection: 's7' },
        { title: 'H6', type: 'COLLECTION', collection: 'h6' },
        { title: 'M3', type: 'COLLECTION', collection: 'm3' },
        { title: 'M5', type: 'COLLECTION', collection: 'm5' },
        pageLink('Mattress Buying Guides', 'how-to-choose-the-right-mattress', [
          pageLink('How to Choose the Right Mattress', 'how-to-choose-the-right-mattress'),
          pageLink('Understanding Mattress Comfort', 'understanding-mattress-comfort-soft-to-firm'),
          pageLink('Memory Foam vs. Hybrid', 'memory-foam-vs-hybrid-mattresses'),
          pageLink('Benefits of Dual Comfort', 'benefits-of-dual-comfort-mattresses'),
        ]),
      ],
    },
    {
      title: 'Adjustable Bases', type: 'COLLECTION', collection: 'adjustable-bases', items: [
        { title: 'Shop All Adjustable Bases', type: 'COLLECTION', collection: 'adjustable-bases' },
        { title: 'Flex L', type: 'COLLECTION', collection: 'flex-l' },
        { title: 'Flex LSX', type: 'COLLECTION', collection: 'flex-lsx' },
        { title: 'Flex SH', type: 'COLLECTION', collection: 'flex-sh' },
        pageLink('Adjustable Base Guides', 'how-to-choose-an-adjustable-base', [
          pageLink('Benefits of an Adjustable Base', 'benefits-of-an-adjustable-base'),
          pageLink('How to Choose an Adjustable Base', 'how-to-choose-an-adjustable-base'),
          pageLink('Matching a Mattress and Base', 'how-to-match-a-mattress-with-an-adjustable-base'),
          pageLink('Split-Head Adjustable Systems', 'understanding-split-head-adjustable-sleep-systems'),
        ]),
      ],
    },
    {
      title: 'Sleep Essentials', type: 'COLLECTION', collection: 'bedding', items: [
        {
          title: 'Pillows', type: 'COLLECTION', collection: 'pillows', items: [
            { title: 'Zoned', type: 'COLLECTION', collection: 'zoned-pillows' },
            { title: 'Filled', type: 'COLLECTION', collection: 'filled-pillows' },
            { title: 'Foam', type: 'COLLECTION', collection: 'foam-pillows' },
            { title: 'Temperature Regulating', type: 'COLLECTION', collection: 'temperature-regulating-pillows' },
          ],
        },
        { title: 'Sheets', type: 'COLLECTION', collection: 'sheets' },
        { title: 'Mattress Protection', type: 'COLLECTION', collection: 'mattress-protectors' },
        { title: 'Comforters', type: 'COLLECTION', collection: 'comforters' },
        { title: 'Cooling & Bedding', type: 'COLLECTION', collection: 'cooling-bedding' },
        { title: 'Mattress Toppers', type: 'COLLECTION', collection: 'mattress-toppers' },
        pageLink('Bedding Guides', 'how-to-find-the-right-pillow', [
          pageLink('How to Find the Right Pillow', 'how-to-find-the-right-pillow'),
          pageLink('How Mattress Protectors Help', 'how-mattress-protectors-help-protect-your-bed'),
          pageLink('Choosing Sheets', 'choosing-sheets-for-standard-and-split-head-mattresses'),
          pageLink('Choosing a Comforter Weight', 'choosing-the-right-comforter-weight'),
        ]),
      ],
    },
    {
      title: 'Bedroom Furniture', type: 'COLLECTION', collection: 'bedroom-furniture', items: [
        { title: 'Headboards', type: 'COLLECTION', collection: 'headboards' },
        { title: 'Platform Bases', type: 'COLLECTION', collection: 'platform-bases' },
      ],
    },
    pageLink('Sleep Guides', 'sleep-guides', [
      pageLink('Explore All Sleep Guides', 'sleep-guides'),
      ...guideGroups.map((group) => hubAnchor(group.title, group.id)),
    ]),
    pageLink('Your Showroom Visit', 'how-the-mysnoozepod-showroom-works', [
      pageLink('Book a Snooze Session', 'book-a-snooze-session'),
      pageLink('Mini Snooze Assessment', 'snooze-assessment'),
      pageLink('How the Showroom Works', 'how-the-mysnoozepod-showroom-works'),
      pageLink('What Is a Snooze Session?', 'what-is-a-snooze-session'),
      pageLink('Prepare for Your Visit', 'how-to-prepare-for-your-showroom-visit'),
      pageLink('Virtual Snooze Sessions', 'how-a-virtual-snooze-session-works'),
      pageLink('What Happens After', 'what-happens-after-your-snooze-session'),
    ]),
    pageLink('Our Story', 'about-us'),
  ],
};

export const footerMenuContract = {
  handle: 'footer',
  title: 'Footer',
  items: [
    pageLink('Sleep Guides', 'sleep-guides'),
    pageLink('Book a Snooze Session', 'book-a-snooze-session'),
    pageLink('Snooze Assessment', 'snooze-assessment'),
    pageLink('Our Story', 'about-us'),
    pageLink('Contact', 'contact-us'),
    pageLink('Delivery Information', 'shipping-policy'),
    pageLink('Returns & 90 Day Sleep Trial', '90-day-sleep-trial'),
    pageLink('Order Support', 'faqs'),
    pageLink('Privacy Policy', 'privacy-policy'),
    pageLink('Terms of Service', 'terms-of-service'),
  ],
};

export const guideHub = {
  title: 'Sleep Guides',
  handle: 'sleep-guides',
  description: 'Explore practical, pressure-free guidance for planning a showroom visit, comparing mattress comfort, coordinating a complete sleep system, and preparing better questions before you buy.',
};
