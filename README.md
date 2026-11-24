# Carte Togo — module régions

Ce dépôt contient les données de départ de la carte et le module de sélection géographique des cinq régions administratives du Togo. Le module est écrit en JavaScript classique et s’intègre à l’instance Leaflet fournie par le module cartographique existant.

> **État du checkout : intégration en attente.** Au démarrage de cette mission, le dépôt ne contenait que `README.md`, `LICENSE`, `togo.geojson` et `togo_regions.geojson`. Les fichiers `carte.html`, `js/carte.js`, `js/marqueurs.js`, `js/etat.js`, `js/main.js`, `data/lieux.json` et les autres modules listés dans l’architecture attendue sont absents. Ils n’ont pas été recréés ici afin de ne pas dupliquer ou remplacer le travail des autres membres.

## Données géographiques

Livrable : [`data/regions.geojson`](data/regions.geojson), une `FeatureCollection` RFC 7946 contenant six features : le contour national (`adminLevel: 0`) et les cinq régions (`adminLevel: 1`).

### Source, attribution et licence

- Source des cinq polygones régionaux : [geoBoundaries — Togo, gbOpen, ADM1](https://github.com/wmgeolab/geoBoundaries/tree/main/releaseData/gbOpen/TGO/ADM1), fichier simplifié `geoBoundaries-TGO-ADM1_simplified.geojson`.
- Le GeoJSON d’origine présent à la racine (`togo_regions.geojson`) a été comparé à l’objet LFS du fichier simplifié GitHub : après normalisation des fins de ligne CRLF, son SHA-256 est `743dc17ca6a926aafe4befc7a9c622149b9b499fbcae1fae150d42948a4a396a`, identique à l’identifiant de contenu du fichier source.
- Licence déclarée par le dépôt geoBoundaries : [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Attribution : geoBoundaries, « Togo ADM1 » (gbOpen, version simplifiée). Les coordonnées ADM1 ne sont pas modifiées ; les propriétés ont été normalisées et le contour ADM0 a été dérivé comme indiqué ci-dessous.
- Référence géodésique : OGC:CRS84 / WGS 84, équivalent usuel EPSG:4326, positions dans l’ordre `[longitude, latitude]`. Le membre `crs` historique de la copie source a été remplacé par cette indication dans `metadata`, conformément au format GeoJSON RFC 7946.

Le contour national est l’union topologique des cinq polygones ADM1 de la même source. Il s’agit donc d’une géométrie dérivée des limites publiées, et non d’un contour approximatif ou d’une seconde source aux limites différentes. Les coordonnées du contour dérivé proviennent toutes des sommets des régions. Le fichier `togo.geojson` d’origine reste intact, mais n’est pas utilisé dans `regions.geojson` : sa généralisation ne coïncide pas avec l’union des limites ADM1.

### Propriétés

Toutes les features ont `properties.name`, `properties.code`, `properties.adminLevel` et `properties.featureRole`.

| Niveau | `code` | `name` | `featureRole` |
|---|---|---|---|
| 0 | `TG` | Togo | `national-boundary` |
| 1 | `TG-M` | Maritime | `region` |
| 1 | `TG-P` | Plateaux | `region` |
| 1 | `TG-C` | Centrale | `region` |
| 1 | `TG-K` | Kara | `region` |
| 1 | `TG-S` | Savanes | `region` |

Les régions conservent aussi les attributs source `shapeName`, `shapeISO`, `shapeID`, `shapeGroup` et `shapeType`.

## API du module

Fichier : [`js/regions.js`](js/regions.js), script classique (pas d’ES Modules, pas de framework, aucune nouvelle carte Leaflet).

- `window.TogoRegions.initialiser(carte, options)` charge et valide `data/regions.geojson`, puis ajoute les régions et le contour à **l’instance Leaflet existante**. Renvoie une `Promise` résolue avec le contrôleur du module.
- `window.initialiserRegions(carte, options)` est un alias pratique pour les scripts classiques.
- Le contrôleur retourné expose `selectionnerRegion(code)`, `retourVueGenerale()`, `getRegionSelectionnee()` et `detruire()`.
- L’espace de noms expose également `TogoRegions.selectionnerRegion(code)`, `TogoRegions.retourVueGenerale()`, `TogoRegions.getRegionSelectionnee()` et `TogoRegions.detruire()` après initialisation.
- Les régions sont sélectionnables par clic ou clavier. Le style sélectionné, le survol, la restauration du style précédent et le bouton de retour sont gérés par le module. Le bouton est injecté dans les contrôles Leaflet et n’apparaît qu’après une sélection.
- La feuille [`css/regions.css`](css/regions.css) ne stylise que les polygones interactifs et ce bouton ; elle n’ajoute ni panneau latéral ni liste persistante.

Options reconnues : `geoJsonUrl` (défaut `data/regions.geojson`), `eventTarget` (défaut `document`), `allerVersRegion`, `recentrerSurTogo`, `pane` et `positionBouton` (défaut `topleft`). La page doit être servie en HTTP(S) pour que `fetch()` puisse charger le GeoJSON ; l’ouverture directe en `file://` n’est pas prise en charge.

## Contrats d’intégration attendus

### Membre 1 — carte (`js/carte.js`)

1. Charger Leaflet et créer la carte une seule fois.
2. Exposer l’instance à `main.js` (ou la passer directement à l’initialiseur).
3. Exposer `allerVersRegion(code)` pour `TG-M`, `TG-P`, `TG-C`, `TG-K` et `TG-S`. Le module appelle cette fonction et ne calcule pas de zoom Leaflet concurrent.
4. Pour le retour national, exposer `recentrerSurTogo()` ; à défaut, le contrat de repli est que `allerVersRegion('TG')` centre la carte sur le pays entier.

Exemple d’appel depuis `main.js`, une fois la carte créée :

```js
await window.TogoRegions.initialiser(carte, {
  allerVersRegion: window.allerVersRegion,
  recentrerSurTogo: window.recentrerSurTogo // optionnel ; sinon le code « TG » est utilisé
});
```

Le nom d’option attendu est `recentrerSurTogo` (orthographe française, comme dans l’API). La feuille de style doit être liée par `carte.html` avec `<link rel="stylesheet" href="css/regions.css">`, et `js/regions.js` doit être chargé après Leaflet et avant l’appel à l’initialiseur.

### Membre 2 — marqueurs (`js/marqueurs.js`) et lieux

Le module émet les événements DOM suivants sur `document` (ils remontent aussi vers `window`) :

- `region-choisie`, avec `event.detail` égal à `{ code, nom }`, par exemple `{ code: 'TG-M', nom: 'Maritime' }` ;
- `retour-vue-generale`, avec `event.detail.regionPrecedente` égal à `{ code, nom }`.

Le gestionnaire des marqueurs doit écouter ces événements, filtrer les lieux selon leur code de région, puis réafficher tous les lieux au retour. Le module régions ne crée, ne supprime et ne duplique aucun marqueur. `data/lieux.json` et `js/marqueurs.js` n’étant pas présents dans ce checkout, le champ régional réel des lieux et le comportement du filtrage restent à raccorder et à vérifier par le Membre 2.

### État global et démarrage (`js/etat.js`, `js/main.js`)

`etat.js` et `main.js` n’étant pas présents, la sélection locale au module est la source immédiate de vérité ; `TogoRegions.getRegionSelectionnee()` la lit. Le chef de projet peut synchroniser son store en écoutant les deux événements ci-dessus. L’initialisation doit intervenir après la création de la carte, sans rechargement de page.

## Validation effectuée

- **GeoJSON/topologie :** six features, les cinq codes et noms attendus, anneaux fermés, coordonnées longitude/latitude dans les plages WGS 84 ; les cinq polygones sont valides. Leur union est un seul polygone valide sans trou ; aucun chevauchement de surface positive n’a été trouvé et aucun sommet extérieur nouveau n’a été créé pour le contour national.
- **JavaScript :** `node --check js/regions.js` réussit. Une simulation Node avec une carte Leaflet factice a validé l’initialisation, la sélection successive des cinq régions, la mise en évidence et la restauration des styles, le survol, les deux événements, les appels au contrat de navigation, le bouton de retour et le nettoyage des couches.
- **Limites des tests :** aucun navigateur, `carte.html`, `js/carte.js`, `js/marqueurs.js`, `js/etat.js`, `js/main.js` ou `data/lieux.json` n’est fourni dans ce dépôt. Les tests réels sur Leaflet, l’affichage responsive dans un navigateur et le filtrage effectif des lieux restent donc à exécuter après intégration. Les règles CSS couvrent téléphone/tablette et respectent `prefers-reduced-motion`, mais cela ne remplace pas un test de viewport.

**État du livrable : développé et vérifié isolément, en attente d’intégration aux modules cartographiques et marqueurs absents de ce checkout.**
