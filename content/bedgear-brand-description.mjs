export const bedgearDescriptionSource = Object.freeze({
  label: 'BEDGEAR Boilerplate - Updated January 2026',
  sharedUrl: 'https://bedgear.pxm.pattern.com/share/RWlH0Qhcsk',
  sourceDate: '2026-01-22',
  version: '2026-01',
});

export const bedgearProductHandles = Object.freeze([
  'flex-l-adjustable-base',
  'flex-lsx-adjustable-base',
  'flex-sh-adjustable-base',
  'cotton-sheet-set',
  'dri-tec-sheet-set',
  'ver-tex-sheet-set',
  'dri-tec-mattress-protector',
  'ver-tex-mattress-protector',
  'stretchwick-mattress-encasement',
  'light-weight-comforter',
  'medium-weight-comforter',
  'ultra-weight-comforter',
  'cooling-performance-throw',
  'solid-white-duvet-sham-set',
  'light-grey-racetrack-duvet-sham-set',
  'react-pro-performance-topper',
  'bedgear-s7-12-memory-foam',
  'bedgear-h6-12-hybrid',
  'bedgear-m3-12-dual-comfort',
  'bedgear-m5-14-dual-comfort',
]);

export const bedgearBrandParagraphs = Object.freeze([
  'Since 2009, BEDGEAR has been redefining the way the world sleeps through innovation, personalization, and sustainability. As the Performance® sleep brand, BEDGEAR creates groundbreaking sleep solutions for those who aim to Wake Ready®. Designed for active lifestyles, BEDGEAR products feature moisture-wicking, instant-cooling, and airflow-maximizing materials that help your body naturally regulate temperature for optimal rest and recovery.',
  'Trusted at the highest level of competition, BEDGEAR is the Official Sleep Partner of the Dallas Mavericks and a preferred choice among professional athletes who rely on personalized sleep to enhance training and game-day readiness.',
  'Driven by the belief that One Size Does Not Fit All®, BEDGEAR designs Performance® Sleep Systems that are personally fit to each sleeper\'s body type, sleep position, and temperature preference—ensuring comfort without compromise, especially critical for individual support for those who sleep with partners. Engineered and manufactured in the USA and overseas, BEDGEAR\'s lineup includes modular mattresses, pillows, sheets, protectors, blankets, and the BEDGEAR Beauty Collection, along with bedding for kids, babies, pets, travel, and more.',
  'BEDGEAR is also committed to reducing waste through smarter design—planting a tree for every online order, incorporating recycled materials into Performance® Pillows, and engineering modular, personally fit products that get it right the first time.',
  'With more than 280 worldwide patents and trademarks and retail presence in over 6,500 stores across the globe, BEDGEAR continues to lead the evolution of personalized sleep.',
]);

export const bedgearBrandDescriptionHtml = [
  `<div data-mysnoozepod-bedgear-boilerplate="${bedgearDescriptionSource.version}">`,
  '<h3>About BEDGEAR</h3>',
  ...bedgearBrandParagraphs.map((paragraph) => `<p>${paragraph}</p>`),
  '</div>',
].join('');

