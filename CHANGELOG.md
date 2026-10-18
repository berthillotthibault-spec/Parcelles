# Changelog

## 10.19.0 · dictée, fin de journée chantier, mode gants, plan imprimable et chiffres verts — 2026-10-18

Données : pas de changement de schéma (version 17). Les surnoms des parcelles et des engins (`aliases`) sont un champ facultatif.

Vitesse :
- la grammaire vocale, les calculs « Pourquoi ? » et le mode gants se chargent à la demande : le démarrage reste au niveau de la 10.18.0 malgré les nouveautés ;
- carte fluide avec des centaines de parcelles (n° 52) : dessin sur un canvas partagé, mise à jour des seules parcelles modifiées, étiquettes recalculées après le déplacement.

Nouveautés :
- dictée enrichie (n° 13) : nombres en lettres (« deux cents », « quatre mille cinq cent vingt »), surnoms des parcelles et des engins (Saisie vocale › Noms et surnoms), entretien et relevé de compteur, observation, sortie de stock, heures et volumes d’un chantier TP, dates relatives (« il y a trois jours », « la semaine dernière ») ; l’écran de vérification reste obligatoire ;
- fin de journée sur un chantier de travaux publics (n° 20) : une ligne par engin avec pavé numérique, compteur et différence avec la veille, quantités, carburant, photo du bon, récapitulatif puis une seule validation annulable, bon prêt à partager ;
- mode gants (n° 21) : Personnaliser › Mode gants (toujours ou automatique en mode terrain), cibles de 64 px, texte agrandi, barre d’actions sous le pouce, suppression par maintien de 600 ms ;
- états vides illustrés (n° 35) : petites illustrations et action utile sur l’accueil, les Travaux, les Parcelles, l’Activité, les Stocks et le Pâturage ;
- plan de l’exploitation en A4 paysage (n° 54) : exploitation, parcelle ou sélection, fond et couleurs au choix, cartouche, légende avec hectares, échelle, nord et tableau des parcelles, à imprimer ou partager en PDF ; échelle métrique sur la carte ;
- « Mon exploitation en chiffres verts » (n° 71) : diversité d’assolement, prairies et infrastructures agro-écologiques, IFT, solde azoté, intrants, GNR par hectare et CO2 estimé, jauges par thème HVE et fiche imprimable ; auto-diagnostic, pas une certification ;
- bouton (i) « Pourquoi ? » (n° 110) sur la prochaine action, les lignes du jour, les alertes, le bilan, la fenêtre météo, les totaux du Pilotage et les automatisations : faits retenus, données manquantes ou exclues, lien vers la règle.

Corrections (relecture avant publication) :
- dictée : noms de parcelles contenant un nombre en lettres, futur (« il faudra ») qui n’enregistre plus un entretien comme fait, durées (« pendant trois heures ») distinguées des heures du jour, engin retenu seulement sur un nom exact, types d’entretien alignés sur le formulaire ;
- fin de journée chantier : case Compteur masquée et annulation proposée selon les droits du rôle opérateur, virgule finale acceptée, fichiers contrôlés par le diagnostic de déploiement ;
- mode gants : jauge de maintien correcte sur les boutons, toasts au-dessus de la barre sur la carte, lecteurs d’écran qui gardent la fenêtre de confirmation ;
- carte : canvas moins gourmand en mémoire sur iPhone ;
- plan : parcelles archivées exclues, cartouche jamais coupé ;
- chiffres verts : absence de traitement signalée comme donnée manquante plutôt que comptée à 0, catalogue phyto pris en compte, nom de la ferme retiré du pied de page ;
- « Pourquoi ? » : clavier capté par la feuille ouverte, liens de modification masqués en lecture seule ;
- états vides : la recherche texte des Travaux est prise en compte.

## 10.18.0 · trésorerie, bilan du soir, import console, partage et carte — 2026-10-15

Données : pas de changement de schéma (version 17). L’échéancier de trésorerie est une préférence locale de l’appareil.

Vitesse :
- les Paramètres, le panneau Couches de la carte, les Automatisations et les centres techniques (application native, plateforme, sécurité, réparation de texte, intégrations) se chargent à la demande : app.js passe de 456 à 408 Kio.

Nouveautés :
- prévisionnel de trésorerie sur 12 mois (n° 86) : Plus › Gestion › Trésorerie, avec solde de départ, ventes, contrats, factures, travaux prévus et échéancier récurrent, courbe mensuelle et point bas ; estimation non contractuelle, masquée au rôle lecteur ;
- bilan de fin de journée sur l’accueil (n° 105) : après 17 h, travaux faits et restants avec « Fait » ou « Reporter à demain », sorties de stock proposées pour les travaux terminés (jamais sans confirmation) ;
- import des travaux de la console du tracteur (n° 124) : fichier TASKDATA.XML ISOXML seul ou dans un ZIP, rapprochement des parcelles par contour ou par nom, aperçu, dédoublonnage et annulation ;
- partager un travail, une observation ou le récapitulatif du jour (n° 19) : texte prêt à envoyer (parcelle, date, produit et dose, lien de position), photo jointe quand elle existe, copie dans le presse-papiers à défaut ;
- assistant distant (n° 104) : la réponse s’affiche au fil de l’eau, contexte enrichi (météo, lots au pré, récoltes, chantiers, stocks bas) et exemple de Worker Cloudflare dans tools/ pour garder la clé côté serveur ;
- « Vous êtes dans : … » (n° 111) : au champ, l’assistant et la carte reconnaissent la parcelle où vous vous trouvez et proposent les actions utiles ; invitation d’un membre par QR code et bouton Partager (n° 122) ;
- carte (n° 30) : étiquettes en pastille lisibles, fiche au survol sur ordinateur, parcelles du jour mises en avant, retards en pointillés rouges et lots au pâturage signalés ;
- documentation d’architecture (ARCHITECTURE.md, n° 156).

Corrections (relecture avant publication) :
- trésorerie : rôle lecteur respecté hors connexion, flux déjà passés exclus, factures échues en retard ;
- import console : statut des tâches, dédoublonnage entre exports, contours concaves ou invalides, fuseau horaire ;
- partage aligné sur le registre phyto (traitement prévu signalé « provisoire ») ;
- bilan du soir : sortie de stock déjà saisie non reproposée, rôle lecteur, accessibilité ;
- assistant : repli JSON complet, culture des récoltes, date locale, annonce unique de la réponse ;
- « Vous êtes dans » : parcelles superposées, changement de jour, feuille rafraîchie ;
- carte : couleurs du prochain travail et des tâches du jour, pas de style retard sur les points.

## 10.17.0 · vitesse, prochaine action, rendement mesuré, NDVI et ferme d’exemple — 2026-10-14

Données : pas de changement de schéma (version 17). La ferme d’exemple vit dans un espace séparé, jamais synchronisé ni sauvegardé.

Vitesse :
- démarrage plus rapide : environ 28 s au lieu de 38,2 s sur un téléphone lent en 3G (mesure iPhone 14, processeur ×4, Fast 3G), JavaScript initial ramené de 2 745 à environ 2 270 Kio ;
- les écrans de gestion, d’agronomie et de réglementation se chargent à la demande, restent disponibles hors connexion, et un clic pendant le chargement n’est plus perdu ;
- synchronisation plus légère (n° 137, étape 1) : les statuts d’envoi et les documents reçus sont enregistrés par lots au lieu d’une écriture par élément.

Nouveautés :
- carte « Prochaine action » sur l’accueil (n° 28) : compte à rebours, météo du créneau, contour de la parcelle et action suivante ; elle se retourne après « Marquer comme fait » ;
- rendement mesuré (n° 90) : proposé depuis les lots de récolte ou une carte de rendement, avec l’écart à la valeur saisie, et rentabilité intra-parcellaire en €/ha (surface non rentable, perte estimée) ;
- état des cultures par satellite (n° 43) : modes « Vigueur (NDVI) » et « Tendance 15 j » sur la carte, mise à jour de toutes les parcelles en une fois, frise des dates et rideau de comparaison ;
- « Explorer une ferme d’exemple » (n° 118) : une exploitation fictive de l’Ain à parcourir sans toucher à vos données, avec un bandeau « Revenir à ma ferme ».

Corrections (relecture avant publication) :
- un écran chargé à la demande qui a échoué se recharge vraiment à la nouvelle tentative, sinon « Recharger » est proposé ;
- une coupure pendant la mise à jour NDVI de toutes les parcelles n’est plus comptée comme actualisée : la relance reprend les parcelles restantes ;
- le rendement mesuré d’une carte garde les seuils de la culture (betterave, ensilage) ;
- la campagne d’une date ne dépend plus du fuseau horaire (lots de récolte du 1er août outre-mer) ;
- la carte « Prochaine action » est redessinée au passage de minuit.

## 10.16.0 · PAC, agronomie, gestion et confort — 2026-10-13

Données : pas de changement de schéma (version 17). Les nouveautés utilisent des enregistrements d’exploitation et des réglages déjà prévus.

Réglementation et PAC (aides indicatives : valeurs datées, sourcées et modifiables) :
- import telepac guidé : le ZIP des parcelles déclarées est reconnu d’office, le numéro PACAGE n’est jamais conservé, et un nouvel import montre ce qui a changé d’une année sur l’autre ;
- vérification du parcellaire : chevauchements, écarts de surface entre saisie, tracé, déclaration et RPG, contours non fermés ;
- couches réglementaires sur la carte (cours d’eau BCAE, hydrographie, Natura 2000, zones vulnérables, pentes) et bandeau indicatif sur la fiche parcelle ; bande le long des cours d’eau exclue des préconisations ;
- Certiphyto des opérateurs, contrôle du pulvérisateur, assurance et conseil stratégique : échéances rappelées sur l’accueil.

Élevage et agronomie :
- bilan fourrager et calendrier de récolte de l’herbe (ensilage, foin, enrubannage) ;
- variétés, lots de semence et essai variétal sur plusieurs années ;
- analyses de sol, grille d’échantillonnage et plan de chaulage, carte « pH du sol » ;
- haies, mares et bosquets, avec la période d’interdiction de taille.

Gestion :
- coût réel du matériel à l’heure et à l’hectare, comparé au barème d’entraide que vous saisissez ;
- marge nette : charges de structure, fermages et aides PAC ;
- export « Pour mon comptable » en CSV ou Excel, ventilé par compte et TVA (une aide, pas une comptabilité légale) ;
- comparaison des campagnes sur 3 à 5 ans, par culture et par parcelle.

Confort et données :
- recherche globale élargie (outils, actions, fautes de frappe tolérées, « travaux semaine dernière ») ;
- protection du stockage contre l’effacement par le navigateur, et nettoyage proposé quand l’espace manque ;
- squelettes de chargement au lieu de « Chargement… » ;
- page Confidentialité qui dit exactement ce qui part sur le réseau, et réglage pour couper l’actualisation météo automatique ;
- confirmation « enregistré » plus perceptible au champ : vibration, coche en mode terrain, bip en option.

Corrections (relecture avant publication) :
- carte : la vérification du parcellaire ne bloque plus le dessin et la mesure après une mise en évidence ; la flèche de vent s’affiche dès l’ouverture de la carte ;
- réimport telepac : une parcelle inchangée (même en L) est mise à jour au lieu d’être dupliquée, et une parcelle renumérotée n’écrase plus sa voisine ;
- recherche : une parcelle nommée « La Campagne » ou « Champ de Mars » se retrouve même quand le nom ressemble à une période ;
- photos libérées de l’appareil : rechargées depuis le cloud pour le dossier sinistre, la galerie, les cartes d’application et les mémos ;
- « Tout effacer de cet appareil » ferme aussi la session cloud ;
- haies : la dérogation se décoche et le contrôle porte sur la date réellement enregistrée ; IAE dessinées sous les parcelles ;
- bilan fourrager, semences, analyses de sol, couches réglementaires, Certiphyto et historique des campagnes : calculs et enregistrements corrigés ;
- accueil sur grand écran : la carte « Bien démarrer » reste en tête.

## 10.15.0 · terrain, gestion, agronomie et sécurité des données — 2026-10-12

Données : pas de changement de schéma (version 17). Les nouveaux dossiers (sinistres, carburant, baux) sont des enregistrements d’exploitation déjà prévus.

Terrain :
- trace GPS du chantier avec la couverture en direct et export GPX ;
- photos terrain géolocalisées, en rafale, étiquetées et visibles sur la carte ;
- riverains, ruchers et voisins à prévenir avant un traitement ;
- silhouette réelle des parcelles dans la liste et en-tête de fiche ; listes du jour plus lisibles avec balayage « Fait » / « Demain » ; actions rapides en tuiles sur ordinateur.

Agronomie et pilotage (aides indicatives, valeurs par défaut à vérifier) :
- l’application retient vos habitudes de saisie, propose l’étape suivante et préremplit les travaux ;
- sommes de températures et stades estimés ; dates de semis selon la température du sol ; alertes sanitaires simples à partir de la météo ;
- alertes de rotation et classement des parcelles par marge/ha ;
- photo d’étiquette ou de facture vers le stock ; fichiers reçus depuis les autres applications par le partage du téléphone.

Gestion :
- marges par culture en €/ha avec les aides PAC, prix d’équilibre et cascade ;
- lot de récolte relié au stock, aux ventes et aux traitements ;
- stocks par lots avec péremption, PPNU, inventaire valorisé au prix moyen et alerte de dérive de prix ;
- économie de l’atelier bovin : marge par UGB et coût de l’herbe ;
- foncier : propriétaires, baux et fermages indexés ;
- dossier sinistre (gibier, grêle, sécheresse) depuis une observation : surface touchée, photos d’origine, météo du jour, perte estimée, PDF et suivi jusqu’à l’indemnisation ;
- carburant GNR : cuve, consommation par engin avec alerte de dérive, et estimation du remboursement TICPE (taux daté et modifiable, ce n’est pas une déclaration).

Données et sécurité :
- écran « Activité » : journal local et cloud réunis, filtres par personne, parcelle, type et période, export CSV ou PDF « Registre des modifications » ;
- sauvegardes chiffrées renforcées (600 000 itérations ; les anciennes restent lisibles) avec un indice de phrase secrète ;
- « Verrouiller Parcelles » en option : code obligatoire, Face ID ou empreinte en plus ; c’est une protection d’accès à l’écran, pas un chiffrement ;
- corbeille groupée par type, avec recherche, auteur de la suppression et restauration liée proposée ; en cloud, purge réservée au propriétaire ;
- collaboration en temps réel visible ; gabarits HTML échappés et politique de sécurité du contenu (CSP) réelle.

Outillage : publication en une commande (tools/release.mjs), contrôle du fonctionnement hors connexion et budget de performance mesuré.

## 10.14.0 · carte, élevage, gestion et fiabilité des données — 2026-10-10

Données : le schéma passe en version 17 (nouvelle collection du carnet sanitaire). La migration est automatique, et une version plus ancienne de l’application restée en cache passe en lecture seule au lieu d’écraser les données.

Carte :
- modifier un contour sommet par sommet, avec la surface avant et après en direct, et refus d’un contour qui se croise ;
- accrochage (« Aimant ») aux limites des parcelles et du RPG, et « Suivre la limite » ;
- mesurer en marchant au GPS, puis créer une parcelle, remplacer un contour ou enregistrer une zone ;
- découper et fusionner des parcelles (la parcelle d’origine est archivée avec ses travaux) ;
- boussole d’approche jusqu’à la parcelle, pastille « Vous êtes dans … » et « Définir l’entrée ici ».

Élevage et gestion :
- chargement UGB/ha, jours de repos et bilan de pâturage (l’azote déposé au pâturage compte dans le plafond de 170 kg N) ;
- pâturage en un geste depuis le mode terrain (amener, sortir, compter un lot ; contrôle abreuvoir et clôture) ;
- carnet sanitaire : soins, ordonnances, délais d’attente viande et lait rappelés sur l’accueil, registre PDF ;
- un seul moteur de marge : un coût inconnu s’affiche « — » au lieu de 0 €, les parcelles sans produit connu sortent du total, les charges manuelles €/ha ne servent plus que de forfait quand aucun travail n’est chiffré, et chaque marge indique sa fiabilité ;
- carte « Ma campagne » sur l’accueil (montants masqués par défaut) et simulateur « Et si… ».

Interface :
- choisir ses activités pour n’afficher que les outils utiles ; carte « Bien démarrer » ;
- feuille « Nouveautés » après chaque mise à jour, sans perte d’une saisie en cours ;
- messages d’erreur compréhensibles avec l’action à faire ; bouton « ? » par écran et aide réécrite ;
- thème Auto, Clair, Sombre ou « Cabine de nuit » ; compteurs animés sur l’accueil.

Synchronisation et sauvegardes :
- conflits réglés champ par champ dans un écran lisible, et fusion automatique des champs modifiés d’un seul côté ;
- restauration avec aperçu des différences et restauration sélective ; dans un espace cloud, restauration complète réservée au propriétaire ;
- export « format ouvert » : CSV, GeoJSON et tableur lisibles sans l’application ;
- ouverture plus rapide (un tiers de JavaScript en moins au démarrage) et rendu limité à l’écran visible.

## 10.13.0 · réglementation, intelligence et carte — 2026-10-10

Réglementation (aides indicatives : les tables sont datées et sourcées, et les valeurs par défaut sont à vérifier) :
- registre phyto : fiche produit (dose max, nombre d’applications, DAR, DRE, ZNT), contrôle avant validation d’un traitement avec motif obligatoire pour passer outre, « Accès interdit jusqu’à … » sur la carte et l’accueil pendant le délai de rentrée, registre par campagne en PDF et CSV ;
- catalogue E-Phy hors connexion : import d’un fichier E-Phy (ou service à configurer), remplissage de la fiche produit par AMM ou nom, alerte sur les AMM retirées ;
- IFT par parcelle, culture et campagne, avec un mode couleur IFT sur la carte ;
- fenêtre de traitement : risque d’inversion de température, rappel des 19 km/h, flèche de vent sur la carte, météo de la fenêtre réelle copiée au registre ;
- azote : plan prévisionnel de fumure par parcelle, cahier d’enregistrement rempli automatiquement, alertes zone vulnérable (périodes d’interdiction, 170 kg N organique) ;
- assistant PAC : déclaration par îlot à recopier dans Telepac, contrôle BCAE 7 (mode couleur sur la carte), simulation de l’éco-régime ;
- couverts et intercultures (CIPAN) : saisie dans les rotations et alertes.

Intelligence et visuel :
- questions en langage naturel (« combien d’azote sur le blé cette campagne ? ») avec le détail du calcul et un export CSV ;
- Travaux › Semaine : « Organise ma semaine » propose un planning selon la météo, la proximité et le matériel, puis l’applique en un geste, avec « Annuler » ;
- graphiques : anneau d’assolement, tendances sur 7 jours de l’accueil, frise de pâturage et courbe NDVI dans la fiche parcelle ;
- transitions fluides entre les écrans (désactivées si l’appareil réduit les animations).

Carte, exports et raccourcis :
- étiquettes de parcelle selon le zoom, sans chevauchement ; légende interactive avec surfaces, qui isole une catégorie d’un appui ;
- export des parcelles en Shapefile, KML (Google Earth) et ISOXML ; import de parcelles depuis un KML ou un KMZ ;
- « Ajouter à mon agenda » et export .ics des 30 prochains jours avec alarmes ; rappels en arrière-plan sur Android ;
- raccourcis de l’icône (Terrain, J’ai fait, Photo, Dicter) et liens directs vers le mode terrain ; le mode plein soleil est mémorisé.

## 10.12.0 · terrain, formulaires et historique — 2026-10-08

- ma tournée du jour : « Démarrer ma journée » enchaîne travaux, tâches, lots à déplacer et entretiens dans l’ordre le plus court, étape par étape (Y aller, Commencer, Fini), avec un récapitulatif du soir ;
- QR codes sur les engins, portails et abreuvoirs : un scan ouvre heures compteur, plein, entretien ou panne avec photo ; planche A4 d’étiquettes en PDF ;
- créneaux météo : chaque travail en attente indique son prochain créneau favorable (vent, rafales, Delta T, pluie), à titre indicatif ; modèle d’automatisation « Créneaux météo du jour » ;
- Travaux : Liste, Calendrier, Tâches et Chantiers deviennent des onglets de l’écran au lieu de fenêtres ; la date des cases du calendrier n’est plus décalée d’un jour ;
- formulaires de travail et de tâche en pastilles (parcelle, type, date, statut, priorité), erreurs affichées sous le champ dans tous les formulaires (matériel, chantier, client, stock, récolte, pâturage, sauvegardes…) ; brouillons enregistrés automatiquement et proposés à la reprise ;
- historique de chaque fiche et « Annuler » sur toute modification ;
- synchronisation : pastille à 5 états, file d’envoi lisible et rappel après 48 h sans envoi ;
- ouverture instantanée, et invitation à installer l’application sur l’écran d’accueil au bon moment ;
- sécurité : factures et contrats de vente réservés à la comptabilité, plus à l’opérateur terrain (règles Firestore à republier).

## 10.11.1 · factures PDF, équipe, carte et accessibilité — 2026-10-08

- factures et avoirs : vrai fichier PDF à partager, imprimer ou enregistrer depuis l’iPhone (Safari et application installée), nouvelle mise en page, logo et couleur de l’entreprise ; un avoir total est exactement égal à la facture ; dossier de campagne, dossier de contrôle et rapports aussi en PDF (sans graphiques) ;
- équipe et autorisations : écran par grade (propriétaire, responsable, collaborateur, opérateur, comptabilité, lecteur), le responsable gère les grades inférieurs, transfert de propriété, invitations révocables, tableau « Qui peut faire quoi » ; appliqué par les règles Firestore (à republier) ;
- carte : un seul outil actif à la fois ; la barre de sélection multiple se ferme en touchant un autre outil ; « Abandonner le tracé ? » avant de perdre un dessin ; mesure effaçable ;
- accessibilité sur téléphone : boutons de 44 px au moins, champs à 16 px, VoiceOver, encoche, contraste renforcé ; option « Plein champ » (grands boutons, texte agrandi) dans Personnaliser ;
- itinéraire : Waze proposé en plus de Plans et Google Maps.

## 10.11.0 · sécurité et grandes améliorations — 2026-10-08

Sécurité et protection des données (à accompagner du déploiement des règles Firebase) :
- invitations : le rôle de l’invitation est imposé, l’invitation ne sert qu’une fois et ne peut jamais donner le rôle propriétaire ;
- cloud : forme des documents contrôlée, suppression définitive des données et des pièces jointes réservée au propriétaire ; les rôles responsable, opérateur terrain et comptabilité peuvent enfin envoyer leurs saisies ;
- un seul onglet écrit à la fois (« Parcelles est déjà ouvert dans une autre fenêtre · Utiliser ici »), les autres se mettent à jour ;
- des données venant d’une version plus récente restent consultables mais ne sont plus réécrites ; copie de sécurité avant chaque migration ;
- rappel « Sauvegarder maintenant » après 14 jours sans sauvegarde hors de l’appareil, partage du ZIP depuis le téléphone, dossier de sauvegarde sur ordinateur ;
- synchronisation fondée sur l’heure du serveur : un appareil à l’heure fausse ne fait plus perdre de modifications ; décalage d’horloge affiché dans le Diagnostic ;
- les fichiers de données réelles et les anciens fichiers inutilisés sont retirés du site publié.

Aujourd’hui :
- salutation selon l’heure, phrase qui résume la journée et carte « Ce matin » (créneau météo, lot au pré, observation urgente, stock bas, entretien), lisible à voix haute ;
- célébration sobre et vibration discrète quand on coche un travail, « Journée bouclée » quand tout est fait ;
- premier lancement « carte d’abord » : parcelles PAC retrouvées et ajoutées en quelques touches ;
- sur grand écran, Aujourd’hui et Travaux en colonnes.

Terrain et carte :
- saisie express « J’ai fait… » en deux gestes ;
- saisie vocale de bout en bout avec fiche de vérification, mémos vocaux gardés hors connexion ;
- suivi GPS continu dans le mode terrain, parcelle et chantier reconnus automatiquement ;
- fonds IGN (photo, plan), surcouche cadastre et création de parcelle depuis le cadastre ;
- carte de l’exploitation téléchargeable pour un usage hors connexion ;
- polices disponibles hors connexion.

Gestion :
- portance des sols et bilan hydrique « Peut-on rentrer dans la parcelle ? » (estimation) ;
- coût de revient €/t, prix d’équilibre et assistant « Compléter les coûts » ;
- commercialisation : contrats de vente et prix moyen réellement obtenu ;
- dossier de campagne imprimable pour la banque, le centre de gestion ou la coopérative ;
- facturation des prestations et des chantiers TP : numérotation continue, avoirs, relance des retards, export CSV ;
- « Prêt pour un contrôle ? » : état des obligations et dossier de contrôle imprimable (indicatif) ;
- consignes aux salariés, « Mes tâches du jour » et pointage des heures, feuille d’heures CSV.

## 10.10.9 · fiabilisation — 2026-10-07

- hors connexion : l’installation du service worker échouait sur un hébergement HTTP/1.1 (téléchargements bloqués, « Cache incomplet ») ; l’invite « Mettre à jour » reste affichée jusqu’au choix ;
- Aujourd’hui et Travaux : un travail ou une tâche en retard coché reste barré « Fait » pour la journée ; rouvrir rétablit l’échéance et le statut d’avant (« En cours ») ; sous-titre « 2 travaux et 1 tâche aujourd’hui » ; direction du vent dans la météo ;
- pâturage : « Déplacer le lot » crée un nouveau passage (historique conservé), modification possible d’un lot à effectif seul, « Sortir » confirmé ; animaux au pré sans les parcelles archivées ;
- carte : « Dessiner » crée une parcelle à partir du tracé, noms des parcelles affichés et masquables, tracé de mesure effaçable, erreurs RPG en français, distances au format français ;
- parcelles : fiche quittée après la corbeille, étoile favori visible, tri « Distance » sans position, campagne au format 2026/27 ;
- modules : retour après un entretien vers l’écran d’origine, dernier entretien correct le même jour, erreur « Stock insuffisant » dans le formulaire, une tâche ISOXML par parcelle ;
- accessibilité : contrastes ≥ 4,5:1 en clair et en sombre (boutons principaux, légende, panneau Couches, onglets), zoom de la carte dégagé du bouton IA sur ordinateur ;
- textes : accords singulier/pluriel dans tous les messages générés ;
- outillage : tests Node exécutables (`npm test`), audit Playwright (`npm run audit`), GitHub Action de tests ; voir `BUGS.md`.

## 10.10.8 · design v3.7 — 2026-10-06

- conformité à la maquette v3 (voir `AUDIT_MAQUETTE.md`) : Aujourd’hui (cases à gauche, résumé cliquable, météo détaillée, activité, bilan), carte (couleurs de culture, fiche, sélection multiple, outil Dessiner), parcelles (initiales, surface, campagne), fiche (barre Voir sur la carte / Nouveau travail, lot au pré), travaux (fait conservé le jour même, recocher pour rouvrir), matériel (nouvel entretien), Plus (carte Assistant IA, pied de version) ;
- nouvelle mission machine : export `TASKDATA.XML` ISO 11783 multi-parcelles ;
- mode sombre lisible sur les nouveaux composants ; build aligné dans `sw.js`, `index.html` et `utils.js`.

## 10.10.1 · design v3 — 2026-10-06

- refonte visuelle mobile selon `design_handoff_parcelles_mobile` : nouvelle feuille `design-v3.css`, chargée en dernier, sans changement de logique ;
- polices Instrument Sans / Instrument Serif, fond crème, cartes arrondies, pastilles sombres pour les filtres et onglets ;
- en-tête avec pastille de synchronisation (À jour / à synchroniser / Hors connexion) ; en-tête masqué sur la carte et la fiche parcelle ;
- Aujourd’hui : carte « prochaine action » sombre, chiffres du jour, carte météo verte ; fiche parcelle teintée de la couleur de culture ;
- carte : recherche et boutons flottants, bouton Outils vert, panneaux de mesure/dessin et sélection multiple sombres ; bouton IA sombre en bas à droite ;
- couleurs de culture du design (blé, colza, maïs, orge, prairies, tournesol, jachère) ; cache hors connexion mis à jour.

## 7.1.8 — 2026-10-03

- ouverture animée avec le symbole Parcelles et suivi des quatre étapes réelles du démarrage, sans attente artificielle ;
- apparitions progressives des écrans, fenêtres, notifications et indicateurs métier ; retours visuels sur les boutons et la navigation ;
- indicateur commun pour les imports, la météo, les sauvegardes, la synchronisation manuelle et l’assistant distant ; progression mesurée du chargement RPG lorsque le total est connu ;
- gestion des opérations simultanées, des erreurs et de l’annulation RPG ; délai maximal de 15 secondes pour la météo ;
- respect de la réduction des mouvements, y compris si la préférence change pendant une animation ; ressources incluses dans le cache hors connexion ;
- dix tests ciblés exécutables à la racine publiée : `node test-motion.mjs` ou `npm run test:motion`. Les anciens scripts de test ciblent l’arborescence source `tests/` et `js/`, absente de cette publication à plat.

## 4.0.0 — 2026-09-14

- architecture de publication canonique et diagnostic de déploiement ;
- service worker versionné et mise à jour contrôlée ;
- navigation quotidienne Aujourd'hui / Carte / Parcelles / Travaux / Plus ;
- import SHP renforcé, fallback interne, ZIP interne, mapping et rollback d'import ;
- sauvegardes automatiques quotidiennes/hebdomadaires/mensuelles et ZIP complet ;
- carte plein écran, satellite, mesures, GPS, dessin de parcelle, points et tournée ;
- tâches et calendrier mois/semaine/liste ;
- météo détaillée et météo par parcelle ;
- assolement, rotations, pilotage et économie ;
- matériel avec historique d'entretien ;
- pâturage, clients/prestation, observations et stocks ;
- photos/documents liés aux parcelles et travaux ;
- recherche globale, assistant local, voix et endpoint IA facultatif ;
- accessibilité, thème sombre, contraste renforcé et responsive ;
- rapports exploitation/parcelle/client/matériel.

## 4.1 — Qualité & Terrain

- Build `2026.09.14-v4.1.0`.
- Raccourcis intelligents sur l'écran Aujourd'hui à partir des travaux récents.
- Recherche globale améliorée : catégories, requêtes comme `parcelles maïs > 5`, tolérance à une petite faute.
- Résultats de recherche regroupés par Parcelles, Travaux, Tâches, Matériel, Clients, etc.
- Parcelles enrichies avec prochain/dernier travail et distance GPS quand disponible.
- Nouveau tri Parcelles par distance.
- Mode terrain : plus aucun déclenchement automatique du GPS à l'ouverture.
- Mode Plein soleil dans le mode terrain.
- Mode terrain utilisable depuis une parcelle sélectionnée même avant activation du GPS.
- Diagnostic transformé en écran Santé de l'application.
- Journal local des 100 dernières erreurs JavaScript.
- État déploiement, IndexedDB, service worker, sauvegardes, stockage et erreurs regroupés dans le diagnostic.
- Nouveau test automatisé `test-v41.mjs`.

## 4.2 — Pilotage

- Build `2026.09.14-v4.2.0`.
- Schéma de données v6.
- Économie désormais historisable par campagne avec `economicsByCampaign`.
- Nouveau moteur `pilotage.js` : produit brut, charges, marge totale et €/ha par culture/parcelle.
- Comparaison de campagnes sans réutiliser silencieusement les données économiques de la campagne courante.
- Stocks : catégorie, prix unitaire, valorisation et seuils.
- Nouveau journal de mouvements de stock : entrée, sortie et ajustement.
- Prix moyen pondéré sur les entrées de stock.
- Sortie de stock impossible si quantité insuffisante, avec rollback atomique.
- Planificateur de campagne en série depuis l'écran Assolement.
- Rapports imprimables/PDF Pilotage et Stocks.
- Coûts matériel enrichis : travaux + entretiens + assurance + amortissement.
- Correction de la lecture des champs `duration`/`fuel` dans les statistiques et rapports.
- Nouveaux tests automatisés `test-v42.mjs`.

## 5.0 — Multi-appareils & Intelligence

- Build `2026.09.14-v5.0.0`.
- Schéma de données v7.
- Nouveaux états locaux : `members`, `assistantMessages`, `devices`.
- Nouvelle entrée **Compte & équipe**.
- Authentification Firebase Email/Password facultative.
- Exploitations cloud indépendantes et sélection d'espace de travail.
- Rôles Propriétaire / Collaborateur / Lecture seule.
- Permissions locales cohérentes avec les rôles cloud.
- Invitations par code liées à une adresse email et à un rôle.
- Liste des membres et changement de rôle par le propriétaire.
- Appareils enregistrés, dernière présence et renommage de l'appareil courant.
- Synchronisation bidirectionnelle par entité.
- Amorçage automatique d'un espace cloud vide avec les données locales existantes.
- Conflit créé lors d'une première synchronisation si local/cloud diffèrent au lieu d'écraser silencieusement.
- Curseur de synchronisation indépendant par exploitation cloud.
- Synchronisation facultative des blobs photos/documents avec Firebase Storage.
- Journal d'activité cloud.
- Synchronisation automatique périodique lorsque l'application est ouverte et connectée.
- Assistant 5.0 avec historique local facultatif.
- Contexte conversationnel réduit envoyé au Worker IA facultatif.
- Liste blanche d'actions IA distantes.
- Confirmation obligatoire avant toute création de travail ou tâche via IA.
- Lecture vocale de la dernière réponse et option d'activation des commandes vocales.
- Diagnostic enrichi avec rôle, compte, appareil et espace cloud.
- Règles Firestore/Storage fournies dans `firebase/`.
- Nouveau test automatisé `test-v50.mjs`.
