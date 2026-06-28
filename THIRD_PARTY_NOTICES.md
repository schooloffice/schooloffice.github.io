# Third-Party Notices

This project vendors browser bundles locally so the editors can keep working offline after the first load. Keep this file in sync whenever a file under `vendor/` is added, removed, or replaced.

This file is an engineering inventory, not legal advice. The repository's own code is licensed under the root MIT `LICENSE`.

## Inventory

| Package | Vendored file(s) | Version | License | SHA-256 |
|---|---|---:|---|---|
| Chart.js | `vendor/chartjs/chart.umd.js` | 4.5.1 | MIT | `48444A82D4EDCB5BEC0F1965FAACDDE18D9C17DB3063D042ABADA2F705C9F54A` |
| @kurkle/color, bundled by Chart.js | `vendor/chartjs/chart.umd.js` | 0.3.2 | MIT | included in Chart.js bundle above |
| docx | `vendor/docx/index.umd.js` | not visible in bundle header | MIT | `02D568D203C0180AF37609BCF5FF6C0919D220F933A88CA896EBA0556A08FAAD` |
| DOMPurify | `vendor/dompurify/purify.min.js` | 3.1.6 | Apache-2.0 OR MPL-2.0 | `C0845096A7C4A6741F362AC506C94C1C7D27DC603BCC1BF64A587F76F2DBE3A1` |
| Font Awesome Free | `vendor/fontawesome/css/all.min.css` | 6.5.1 | Code: MIT; Fonts: SIL OFL 1.1; Icons: CC BY 4.0 | `C22CFB6520A7FDBB738632834019ACF47C78B1279462C0EB4CB83BAE83ECB5A7` |
| Font Awesome Free | `vendor/fontawesome/webfonts/fa-regular-400.woff2` | 6.5.1 | SIL OFL 1.1 | `2BCCECF0BC7E96CD5CE4003ABEB3AE9EE4A3D19158C4E6EDFD2DF32D2F0D5721` |
| Font Awesome Free | `vendor/fontawesome/webfonts/fa-solid-900.woff2` | 6.5.1 | SIL OFL 1.1 | `9FC85F3A4544AB0D570C7F8F9BBB88DB8D92C359B2707580EA8B07C75673EAE2` |
| html2canvas | `vendor/html2canvas/html2canvas.min.js` | 1.4.1 | MIT | `E87E550794322E574A1FDA0C1549A3C70DAE5A93D9113417A429016838EAB8CB` |
| html2pdf.js bundle | `vendor/html2pdf/html2pdf.bundle.min.js` | not visible in bundle header | MIT-family bundled notices; see `vendor/html2pdf/html2pdf.bundle.min.js.LICENSE.txt` | `85E6EE9CE246E3AE4424313F7E46A5ED860A28D757811DE8DC9C43F306049D65` |
| Mammoth | `vendor/mammoth/mammoth.browser.min.js` | not visible in bundle header | BSD-2-Clause | `596EF52239E52D8EE3CEE10B2EE4A72596ABF900D0E4F468593F956E9F1809B0` |
| PptxGenJS | `vendor/pptxgenjs/pptxgen.bundle.js` | 4.0.1 | MIT | `4FB9EAC5CFEFB213E2D8743C2B7151025F31BFB3F834C73C12062916DAA0F3F8` |
| PptxGenJS license text | `vendor/pptxgenjs/LICENSE` | 4.0.1 bundle companion | MIT | `7A2BFE96150786ED1908B8E63F98EBAB88875C1E79E28FAFF6649E0F11F77E52` |

## Maintenance Rules

- Do not replace a vendored bundle without updating this inventory and the hash.
- Preserve upstream copyright/license headers.
- If a minified bundle points to a generated `.LICENSE.txt` file, keep that file next to the bundle.
- Before adding GPL, AGPL, SSPL, commercial, cloud-backed, or Pro-gated dependencies, make a separate product/legal decision.
