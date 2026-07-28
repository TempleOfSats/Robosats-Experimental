# Offline F2F geography

These assets power the Cash F2F approximate-area picker without contacting a
tile server or geocoder.

- `f2f-world.geo.json` is derived from Natural Earth
  `ne_50m_admin_0_countries.geojson`.
- `f2f-cities.json` is derived from Natural Earth
  `ne_50m_populated_places_simple.geojson`, then supplemented with documented
  Bitcoin circular-economy locations from
  `scripts/f2f-bitcoin-cities.json`.

Natural Earth data is in the public domain:
<https://www.naturalearthdata.com/about/terms-of-use/>

The country geometry is cleaned and simplified with topology and small shapes
preserved:

```sh
mapshaper ne_50m_admin_0_countries.geojson \
  -clean \
  -simplify weighted 15% keep-shapes \
  -filter-fields ADM0_A3 \
  -rename-fields A3=ADM0_A3 \
  -o format=geojson precision=0.05 f2f-world.geo.json
```

The city index retains only the display name, country, region, ISO country
code, coordinates, and population used for local result ranking. Coordinates
selected by the application are still rounded before they enter an order.
Project names and research sources remain build-time provenance and are not
included in the browser asset. Antarctic research stations and islands are
excluded because they are not useful F2F meeting locations.

After regenerating the Natural Earth city index, restore the curated locations:

```sh
node scripts/merge-f2f-bitcoin-cities.mjs
```

The curated additions cover established local initiatives that are absent from
Natural Earth's compact populated-place layer:

- Lugano Plan B: <https://www.lugano.ch/en/la-mia-citta/la-citta-si-racconta/progetti/plan-b.html>
- Arnhem Bitcoinstad: <https://www.arnhembitcoinstad.nl/>
- Bitcoin Valley in Rovereto: <https://bitcoinvalley.eu/it/home-it/>
- Bitcoin Beach in El Zonte and Punta Mango: <https://www.bitcoinbeach.com/>
- Bitcoin Jungle around Uvita and Dominical: <https://www.bitcoinjungle.app/visit-us>
- Bitcoin Ekasi in Mossel Bay: <https://bitcoinekasi.com/>
- Bitcoin Island in Boracay: <https://bitcoinislandproject.com/>
- Bitcoin Lake in Panajachel: <https://bitcoinconfederation.org/hub/bitcoin-lake-guatemala/>
- Praia Bitcoin Jericoacoara: <https://bitcoinbeachbr.org/>
- Prospera's Bitcoin district on Roatan: <https://www.prospera.co/en/solutions/crypto>

Keep both files within the raw and gzip limits enforced by
`scripts/check-static-asset-budgets.mjs`.
