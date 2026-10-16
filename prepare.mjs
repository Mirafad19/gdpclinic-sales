// Preserve the supplied storefront and extract its existing product metadata.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('GDP Clinic_ Recovery Guides & Telehealth.html', 'utf8');
const match = source.match(/var PRODUCTS = (\[[\s\S]*?\n  \]);/);
if (!match) throw new Error('Product catalogue not found');
const products = vm.runInNewContext('(' + match[1] + ')');
writeFileSync('catalog.json', JSON.stringify(products.map(p => ({ ...p, amount: Number(p.price.replace(/\D/g, '')) * 100 })), null, 2));
let html = source.replace('showThanks(p);', 'window.clinicCheckout(p.id);')
  .replace(/<!-- THANK YOU MODAL -->[\s\S]*?(?=<!-- Precomputed globe data)/, '')
  .replace(/  function showThanks\(p\)\{[\s\S]*?(?=  renderCards\(\);)/, '')
  .replaceAll('PDF Guide', 'Online Guide')
  .replace('Download step-by-step PDF programs', 'Read step-by-step recovery programs')
  .replace('guides to download', 'guides to read online')
  .replace('Step-by-step PDF programs for pain relief and rehab, ready to download instantly.', 'Step-by-step recovery programs for pain relief and rehab. Pay securely and read every module online.')
  .replace('physiotherapist-designed PDF programs', 'physiotherapist-designed recovery programs')
  .replace('Secure checkout link added at launch', 'Secure payment · Instant access after confirmation')
  .replace('delivered instantly as a PDF.', 'available to read online immediately after payment is confirmed.')
  .replace('</head>', '<link rel="stylesheet" href="/checkout.css">\n</head>')
  .replace('</body>', '<script src="/checkout.js" defer></script>\n</body>');
writeFileSync('public/index.html', html);
