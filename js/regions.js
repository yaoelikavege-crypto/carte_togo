/*
 * Navigation régionale du Togo — module Leaflet classique (sans ES Modules).
 * Le module reçoit l'instance Leaflet créée par js/carte.js; il n'en crée pas.
 */
(function (global) {
  'use strict';

  const REGIONS_ATTENDUES = [
    { code: 'TG-M', nom: 'Maritime' },
    { code: 'TG-P', nom: 'Plateaux' },
    { code: 'TG-C', nom: 'Centrale' },
    { code: 'TG-K', nom: 'Kara' },
    { code: 'TG-S', nom: 'Savanes' }
  ];

  const COULEURS = Object.freeze({
    'TG-M': '#4f8a78',
    'TG-P': '#d49a55',
    'TG-C': '#d86f5b',
    'TG-K': '#4d83a6',
    'TG-S': '#8474b8'
  });

  const STYLE_CONTOUR_NATIONAL = Object.freeze({
    color: '#16343b',
    weight: 2.6,
    opacity: 0.96,
    fill: false,
    fillOpacity: 0,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    className: 'togo-region-contour-national'
  });

  let controleurActif = null;

  function erreur(message) {
    return new Error('[TogoRegions] ' + message);
  }

  function avertir(message) {
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('[TogoRegions] ' + message);
    }
  }

  function journaliserErreur(message, cause) {
    if (global.console && typeof global.console.error === 'function') {
      global.console.error('[TogoRegions] ' + message, cause || '');
    }
  }

  function validerGeometrie(feature, libelle) {
    const geometry = feature && feature.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
      throw erreur('Géométrie GeoJSON invalide pour « ' + libelle + ' ».');
    }

    const polygones = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!polygones.length) {
      throw erreur('Aucun polygone fourni pour « ' + libelle + ' ».');
    }
    polygones.forEach(function (polygone) {
      if (!Array.isArray(polygone) || !polygone.length) {
        throw erreur('Anneau polygonal manquant pour « ' + libelle + ' ».');
      }
      polygone.forEach(function (anneau) {
        if (!Array.isArray(anneau) || anneau.length < 4) {
          throw erreur('Anneau polygonal trop court pour « ' + libelle + ' ».');
        }
        const premier = anneau[0];
        const dernier = anneau[anneau.length - 1];
        if (!Array.isArray(premier) || !Array.isArray(dernier) || premier[0] !== dernier[0] || premier[1] !== dernier[1]) {
          throw erreur('Anneau non fermé pour « ' + libelle + ' ».');
        }
      });
    });

    let nombrePositions = 0;
    function parcourir(noeud) {
      if (!Array.isArray(noeud)) return;
      if (noeud.length >= 2 && typeof noeud[0] === 'number' && typeof noeud[1] === 'number') {
        const longitude = noeud[0];
        const latitude = noeud[1];
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
          throw erreur('Coordonnée longitude/latitude hors plage pour « ' + libelle + ' ».');
        }
        nombrePositions += 1;
        return;
      }
      noeud.forEach(parcourir);
    }
    parcourir(geometry.coordinates);
    if (nombrePositions < 4) {
      throw erreur('Géométrie trop courte pour « ' + libelle + ' ».');
    }
  }

  function validerCollection(collection) {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      throw erreur('Le fichier chargé doit être une FeatureCollection GeoJSON.');
    }
    if (collection.features.length !== REGIONS_ATTENDUES.length + 1) {
      throw erreur('La collection doit contenir le contour national et exactement cinq régions.');
    }

    const regionsParCode = new Map();
    const frontieresNationales = [];

    collection.features.forEach(function (feature) {
      if (!feature || feature.type !== 'Feature' || !feature.properties) {
        throw erreur('Une feature GeoJSON ne contient pas les propriétés attendues.');
      }

      const proprietes = feature.properties;
      const role = proprietes.featureRole;
      const niveau = Number(proprietes.adminLevel);
      if (role === 'national-boundary' || niveau === 0) {
        validerGeometrie(feature, proprietes.name || 'Togo');
        frontieresNationales.push(feature);
        return;
      }

      if (role === 'region' || niveau === 1) {
        const code = String(proprietes.code || proprietes.shapeISO || '').toUpperCase();
        const nom = proprietes.name || proprietes.nom || proprietes.shapeName;
        if (!code || !nom) {
          throw erreur('Une région n’a pas de code ou de nom administratif.');
        }
        if (regionsParCode.has(code)) {
          throw erreur('Le code régional « ' + code + ' » apparaît plusieurs fois.');
        }
        validerGeometrie(feature, nom);
        regionsParCode.set(code, { feature: feature, code: code, nom: String(nom).replace(/ Region$/, '') });
      }
    });

    if (frontieresNationales.length !== 1) {
      throw erreur('Une seule feature de contour national (adminLevel 0) est requise.');
    }

    const regions = REGIONS_ATTENDUES.map(function (attendue) {
      const region = regionsParCode.get(attendue.code);
      if (!region) {
        throw erreur('La région ' + attendue.nom + ' (' + attendue.code + ') est absente du GeoJSON.');
      }
      if (region.nom !== attendue.nom) {
        throw erreur('Le code ' + attendue.code + ' correspond à « ' + region.nom + ' », pas à « ' + attendue.nom + ' ».');
      }
      return region;
    });

    if (regionsParCode.size !== REGIONS_ATTENDUES.length) {
      const codesInattendus = Array.from(regionsParCode.keys()).filter(function (code) {
        return !REGIONS_ATTENDUES.some(function (region) { return region.code === code; });
      });
      throw erreur('La collection doit contenir exactement les cinq régions attendues. Codes inattendus : ' + codesInattendus.join(', '));
    }

    return {
      contourNational: frontieresNationales[0],
      regions: regions
    };
  }

  async function chargerCollection(url) {
    if (typeof global.fetch !== 'function') {
      throw erreur('fetch() est requis pour charger ' + url + '.');
    }

    let response;
    try {
      response = await global.fetch(url, { headers: { Accept: 'application/geo+json, application/json' } });
    } catch (cause) {
      throw erreur('Échec du chargement de « ' + url + ' » : ' + (cause && cause.message ? cause.message : cause));
    }

    if (!response || response.ok === false) {
      const status = response && response.status ? ' (HTTP ' + response.status + ')' : '';
      throw erreur('Impossible de charger le GeoJSON « ' + url + ' »' + status + '.');
    }

    try {
      return await response.json();
    } catch (cause) {
      throw erreur('Le fichier « ' + url + ' » n’est pas un JSON valide : ' + (cause && cause.message ? cause.message : cause));
    }
  }

  function creerEvenement(nom, detail) {
    if (typeof global.CustomEvent === 'function') {
      return new global.CustomEvent(nom, { bubbles: true, detail: detail });
    }

    const document = global.document;
    if (document && typeof document.createEvent === 'function') {
      const evenement = document.createEvent('CustomEvent');
      evenement.initCustomEvent(nom, true, false, detail);
      return evenement;
    }

    throw erreur('CustomEvent n’est pas disponible dans cet environnement.');
  }

  function initialiser(carte, options) {
    const configuration = options || {};
    const L = global.L;
    if (!L || typeof L.geoJSON !== 'function' || typeof L.control !== 'function' || !L.DomUtil) {
      return Promise.reject(erreur('Leaflet doit être chargé avant js/regions.js.'));
    }
    if (!carte || typeof carte.addLayer !== 'function' || typeof carte.removeLayer !== 'function') {
      return Promise.reject(erreur('Passez à TogoRegions.initialiser() l’instance Leaflet déjà créée par js/carte.js.'));
    }

    const url = configuration.geoJsonUrl || configuration.dataUrl || 'data/regions.geojson';
    const cibleEvenements = configuration.eventTarget || global.document || global;

    return chargerCollection(url).then(function (collection) {
      const donnees = validerCollection(collection);

      if (controleurActif) {
        controleurActif.detruire();
      }

      let regionSelectionnee = null;
      let codeSurvole = null;
      let controleAjoute = false;
      const calquesParCode = new Map();
      const ecoutesClavier = new Map();
      const avertissementsEmis = new Set();
      let calqueRegions = null;
      let calqueContour = null;

      function avertirUneFois(cle, message) {
        if (avertissementsEmis.has(cle)) return;
        avertissementsEmis.add(cle);
        avertir(message);
      }

      function emettre(nom, detail) {
        if (!cibleEvenements || typeof cibleEvenements.dispatchEvent !== 'function') {
          avertirUneFois('events', 'Aucune cible DOM ne peut recevoir les événements personnalisés.');
          return;
        }
        try {
          cibleEvenements.dispatchEvent(creerEvenement(nom, detail));
        } catch (cause) {
          journaliserErreur('Impossible d’émettre l’événement « ' + nom + ' ».', cause);
        }
      }

      function appelerFonction(fonction, argumentsFonction, libelle) {
        try {
          const resultat = fonction.apply(global, argumentsFonction);
          if (resultat && typeof resultat.then === 'function') {
            resultat.catch(function (cause) {
              journaliserErreur('La fonction « ' + libelle + ' » a échoué.', cause);
            });
          }
          return true;
        } catch (cause) {
          journaliserErreur('La fonction « ' + libelle + ' » a échoué.', cause);
          return false;
        }
      }

      function allerVers(code) {
        const fonction = typeof configuration.allerVersRegion === 'function'
          ? configuration.allerVersRegion
          : global.allerVersRegion;
        if (typeof fonction !== 'function') {
          avertirUneFois('allerVersRegion', 'Dépendance manquante : js/carte.js doit exposer allerVersRegion(code). Le style et la sélection restent actifs, mais le zoom n’est pas exécuté.');
          return false;
        }
        return appelerFonction(fonction, [code], 'allerVersRegion');
      }

      function revenirAuTogo() {
        const fonctionRetour = typeof configuration.recentrerSurTogo === 'function'
          ? configuration.recentrerSurTogo
          : global.recentrerSurTogo;
        if (typeof fonctionRetour === 'function') {
          return appelerFonction(fonctionRetour, [], 'recentrerSurTogo');
        }

        const fonctionNavigation = typeof configuration.allerVersRegion === 'function'
          ? configuration.allerVersRegion
          : global.allerVersRegion;
        if (typeof fonctionNavigation === 'function') {
          // Contrat d’intégration : le code réservé « TG » recentre sur le pays entier.
          return appelerFonction(fonctionNavigation, ['TG'], 'allerVersRegion("TG")');
        }

        avertirUneFois('vue-generale', 'Pour rétablir le zoom national, js/carte.js doit exposer recentrerSurTogo() ou accepter le code réservé « TG » dans allerVersRegion(code).');
        return false;
      }

      function styleRegion(code) {
        const selectionnee = Boolean(regionSelectionnee && regionSelectionnee.code === code);
        const survolee = !selectionnee && codeSurvole === code;
        return {
          color: selectionnee ? '#17363c' : '#f5f7f2',
          weight: selectionnee ? 3.2 : (survolee ? 2.35 : 1.45),
          opacity: selectionnee ? 1 : 0.94,
          fillColor: COULEURS[code] || '#64827b',
          fillOpacity: selectionnee ? 0.82 : (survolee ? 0.69 : 0.55),
          lineCap: 'round',
          lineJoin: 'round',
          className: 'togo-region-shape'
        };
      }

      function mettreAJourAria() {
        calquesParCode.forEach(function (calque, code) {
          if (typeof calque.getElement !== 'function') return;
          const element = calque.getElement();
          if (element) {
            element.setAttribute('aria-pressed', String(Boolean(regionSelectionnee && regionSelectionnee.code === code)));
          }
        });
      }

      function appliquerStyles() {
        calquesParCode.forEach(function (calque, code) {
          if (typeof calque.setStyle === 'function') calque.setStyle(styleRegion(code));
        });
        mettreAJourAria();

        if (regionSelectionnee) {
          const calqueSelectionne = calquesParCode.get(regionSelectionnee.code);
          if (calqueSelectionne && typeof calqueSelectionne.bringToFront === 'function') {
            calqueSelectionne.bringToFront();
          }
        }
        if (calqueContour && typeof calqueContour.bringToFront === 'function') {
          calqueContour.bringToFront();
        }
      }

      function montrerBoutonRetour() {
        if (!controleAjoute) {
          controleRetour.addTo(carte);
          controleAjoute = true;
        }
      }

      function masquerBoutonRetour() {
        if (controleAjoute) {
          controleRetour.remove();
          controleAjoute = false;
        }
      }

      function selectionnerRegion(codeDemande) {
        const code = String(codeDemande || '').trim().toUpperCase();
        const region = donnees.regions.find(function (candidate) { return candidate.code === code; });
        if (!region) {
          avertir('Code régional inconnu : « ' + code + ' ». Codes autorisés : ' + REGIONS_ATTENDUES.map(function (item) { return item.code; }).join(', ') + '.');
          return false;
        }

        regionSelectionnee = { code: region.code, nom: region.nom };
        codeSurvole = null;
        appliquerStyles();
        montrerBoutonRetour();
        allerVers(region.code);
        emettre('region-choisie', { code: region.code, nom: region.nom });
        return true;
      }

      function retourVueGenerale() {
        if (!regionSelectionnee) return false;

        const precedente = { code: regionSelectionnee.code, nom: regionSelectionnee.nom };
        regionSelectionnee = null;
        codeSurvole = null;
        appliquerStyles();
        masquerBoutonRetour();
        revenirAuTogo();
        emettre('retour-vue-generale', { regionPrecedente: precedente });
        return true;
      }

      function gererClavier(calque, code, nom) {
        if (typeof calque.getElement !== 'function' || typeof calque.on !== 'function') return;

        function aLajout() {
          const element = calque.getElement();
          if (!element || typeof element.addEventListener !== 'function' || ecoutesClavier.has(calque)) return;
          element.setAttribute('role', 'button');
          element.setAttribute('tabindex', '0');
          element.setAttribute('aria-label', 'Sélectionner la région ' + nom);
          element.setAttribute('aria-pressed', String(Boolean(regionSelectionnee && regionSelectionnee.code === code)));

          const gestionnaire = function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            selectionnerRegion(code);
          };
          element.addEventListener('keydown', gestionnaire);
          ecoutesClavier.set(calque, { element: element, gestionnaire: gestionnaire });
        }

        function auRetrait() {
          const ecoute = ecoutesClavier.get(calque);
          if (!ecoute) return;
          ecoute.element.removeEventListener('keydown', ecoute.gestionnaire);
          ecoutesClavier.delete(calque);
        }

        calque.on('add', aLajout);
        calque.on('remove', auRetrait);
        aLajout();
      }

      const calquesOptions = { bubblingMouseEvents: false };
      if (configuration.pane) calquesOptions.pane = configuration.pane;
      calqueRegions = L.geoJSON(donnees.regions.map(function (region) { return region.feature; }), Object.assign({}, calquesOptions, {
        style: function (feature) {
          const code = String(feature.properties.code || feature.properties.shapeISO || '').toUpperCase();
          return styleRegion(code);
        },
        onEachFeature: function (feature, calque) {
          const code = String(feature.properties.code || feature.properties.shapeISO || '').toUpperCase();
          const nom = feature.properties.name || feature.properties.nom || feature.properties.shapeName;
          calquesParCode.set(code, calque);
          calque.on({
            mouseover: function () {
              if (regionSelectionnee && regionSelectionnee.code === code) return;
              codeSurvole = code;
              if (typeof calque.setStyle === 'function') calque.setStyle(styleRegion(code));
              if (typeof calque.bringToFront === 'function') calque.bringToFront();
              if (calqueContour && typeof calqueContour.bringToFront === 'function') calqueContour.bringToFront();
            },
            mouseout: function () {
              if (codeSurvole === code) codeSurvole = null;
              if (typeof calque.setStyle === 'function') calque.setStyle(styleRegion(code));
              if (calqueContour && typeof calqueContour.bringToFront === 'function') calqueContour.bringToFront();
            },
            click: function () {
              selectionnerRegion(code);
            }
          });
          gererClavier(calque, code, String(nom).replace(/ Region$/, ''));
        }
      }));

      // Dessiner les régions d’abord, puis le contour national afin de garder
      // la silhouette extérieure nette sans masquer les marqueurs (pane Leaflet).
      calqueRegions.addTo(carte);
      calqueContour = L.geoJSON(donnees.contourNational, Object.assign({}, calquesOptions, {
        style: Object.assign({}, STYLE_CONTOUR_NATIONAL),
        interactive: false
      }));
      calqueContour.addTo(carte);

      const controleRetour = L.control({ position: configuration.positionBouton || 'topleft' });
      controleRetour.onAdd = function () {
        const conteneur = L.DomUtil.create('div', 'togo-region-return-control');
        const boutonRetour = L.DomUtil.create('button', 'togo-region-return-button', conteneur);
        boutonRetour.type = 'button';
        boutonRetour.textContent = 'Retour à la vue générale';
        boutonRetour.setAttribute('aria-label', 'Retour à la vue générale du Togo');
        boutonRetour.title = 'Afficher de nouveau tout le Togo';
        boutonRetour.addEventListener('click', function (event) {
          event.preventDefault();
          retourVueGenerale();
        });
        if (L.DomEvent) {
          if (typeof L.DomEvent.disableClickPropagation === 'function') L.DomEvent.disableClickPropagation(conteneur);
          if (typeof L.DomEvent.disableScrollPropagation === 'function') L.DomEvent.disableScrollPropagation(conteneur);
        }
        return conteneur;
      };

      const controleur = {
        selectionnerRegion: selectionnerRegion,
        retourVueGenerale: retourVueGenerale,
        getRegionSelectionnee: function () {
          return regionSelectionnee ? { code: regionSelectionnee.code, nom: regionSelectionnee.nom } : null;
        },
        detruire: function () {
          ecoutesClavier.forEach(function (ecoute) {
            ecoute.element.removeEventListener('keydown', ecoute.gestionnaire);
          });
          ecoutesClavier.clear();
          masquerBoutonRetour();
          carte.removeLayer(calqueRegions);
          carte.removeLayer(calqueContour);
          if (controleurActif === controleur) controleurActif = null;
        }
      };

      controleurActif = controleur;
      return controleur;
    });
  }

  function controllerOuAvertir() {
    if (!controleurActif) {
      avertir('Le module n’est pas initialisé. Appelez d’abord TogoRegions.initialiser(carte).');
      return null;
    }
    return controleurActif;
  }

  const api = Object.freeze({
    initialiser: initialiser,
    selectionnerRegion: function (code) {
      const controleur = controllerOuAvertir();
      return controleur ? controleur.selectionnerRegion(code) : false;
    },
    retourVueGenerale: function () {
      const controleur = controllerOuAvertir();
      return controleur ? controleur.retourVueGenerale() : false;
    },
    getRegionSelectionnee: function () {
      const controleur = controleurActif;
      return controleur ? controleur.getRegionSelectionnee() : null;
    },
    detruire: function () {
      const controleur = controleurActif;
      if (controleur) controleur.detruire();
    },
    regions: Object.freeze(REGIONS_ATTENDUES.map(function (region) { return Object.freeze({ code: region.code, nom: region.nom }); }))
  });

  global.TogoRegions = api;
  // Alias pratique pour les scripts classiques de js/main.js.
  global.initialiserRegions = initialiser;
})(window);
