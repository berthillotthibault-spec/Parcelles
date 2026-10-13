// n° 125 : aide contextuelle par écran (logique pure). Chaque fiche : titre, 3 puces, lien utile
// (data-action existante) et une astuce montrée une seule fois. `match` relie la fiche au titre
// des fenêtres ouvertes par modal(), pour couvrir les modules sans modifier chacun d'eux.

export const HELP = {
  'field-photos': {match: /^Photos terrain/i, title: 'Photos terrain', points: [
    'La position est relevée au moment de la photo et la parcelle est trouvée seule, sans la choisir avant.',
    'Pour une photo importée, le lieu vient des données GPS de l’image ; les autres informations de l’appareil sont retirées.',
    'Les étiquettes (adventices, maladie, clôture…) servent de filtre dans la fiche parcelle et sur la couche Photos de la carte.'
  ]},
  'herd-health': {match: /^Carnet sanitaire/i, title: 'Carnet sanitaire', points: [
    'Chaque soin vétérinaire se note avec le médicament, l’ordonnance et les délais d’attente viande et lait.',
    'Tant qu’un délai court, l’accueil rappelle de ne pas vendre ni abattre les animaux concernés, ou d’écarter le lait.',
    'Le registre de l’année s’imprime en PDF. Les soins sont conservés 5 ans, sans suppression automatique.'
  ], tip: 'Astuce : ajoutez d’abord la photo de l’ordonnance dans Documents pour la relier au soin.'},
  'crop-margins': {match: /^Marges par culture/i, title: 'Marges par culture', points: [
    'Produit, charges opérationnelles, marge brute, mécanisation puis marge directe, en €/ha et par culture.',
    'Les aides découplées et l’éco-régime se saisissent une fois en €/ha ; elles s’ajoutent à la marge directe.',
    'Un travail sans coût n’est pas compté 0 € : la marge est signalée « partielle ».'
  ], tip: 'Astuce : le prix d’équilibre vient du coût de revient ; comparez-le à vos contrats.'},
  'lot-sheet': {match: /^Traçabilité · lot/i, title: 'Fiche de traçabilité du lot', points: [
    'La fiche reprend les traitements, engrais et semis de la parcelle sur la campagne, jusqu’à la date de récolte.',
    'Le DAR est comparé au délai entre le traitement et la récolte : « non respecté » signale un délai trop court (indicatif).',
    'Le QR code ouvre cette fiche dans Parcelles, sur un appareil qui a les données de l’exploitation.'
  ]},
  'grain-norms': {match: /^Normes de poids/i, title: 'Normes de poids', points: [
    'Le poids aux normes corrige l’humidité vers la norme (15 % blé, 15,5 % maïs) puis retire les impuretés en excès.',
    'Ces valeurs sont modifiables : reprenez celles de votre contrat ou de votre organisme stockeur.',
    'Le poids aux normes est celui qui entre en stock quand vous appuyez sur « Entrer en stock ».'
  ]},
  'stock-lots': {match: /^Lots et alertes d’intrants/i, title: 'Lots et alertes d’intrants', points: [
    'Le lot, le fournisseur et la date de péremption se notent à l’entrée en stock ; les sorties consomment les lots les plus anciens.',
    'Un produit périmé ou dont l’AMM est retirée est signalé ; marquez-le « PPNU à évacuer » pour la prochaine collecte ADIVALOR.',
    'Une dérive de prix est signalée quand le dernier achat s’écarte de plus de 15 % du prix moyen.'
  ]},
  inventory: {match: /^Inventaire valorisé/i, title: 'Inventaire valorisé', points: [
    'Choisissez une date : quantités et valeurs sont recalculées à cette date au coût moyen pondéré (PMP).',
    'Chaque entrée chiffrée met à jour le PMP ; les sorties sont valorisées au PMP du jour.',
    'Les coûts déjà enregistrés ne changent qu’après votre confirmation (« Revaloriser »).'
  ]},
  'herd-economics': {match: /^Atelier bovin/i, title: 'Atelier bovin', points: [
    'La marge brute de l’atelier : ventes d’animaux moins achats, aliments sortis du stock, frais vétérinaires et coût des prairies.',
    'Les aliments sont les sorties de stock de catégorie « Aliment », valorisées au prix moyen du jour ; le coût d’un soin se saisit dans le carnet sanitaire.',
    'Marge par UGB et coût de l’herbe par animal et par jour s’appuient sur les passages au pâturage.'
  ]},
  land: {match: /^Foncier et fermages/i, title: 'Foncier et fermages', points: [
    'Le bail de chaque parcelle se saisit dans l’onglet « Foncier » de la fiche : bailleur, cadastre, type de bail, dates et fermage.',
    'L’indice national des fermages se saisit une fois par an ; la valeur pré-remplie est datée et à vérifier.',
    'Un avis d’échéance PDF par bailleur reprend les fermages et la part de taxe foncière ; les baux à moins de 18 mois de l’échéance sont rappelés.'
  ]},
  claims: {match: /^Sinistres|^Sinistre ·|dossier sinistre/i, title: 'Dossiers sinistres', points: [
    'Un dossier s’ouvre depuis une observation de dégâts (gibier, grêle, sécheresse…) : culture, variété et rendement attendu sont repris de la parcelle.',
    'Surface touchée saisie, mesurée en marchant ou en part de la parcelle ; la perte est estimée en tonnes et en euros.',
    'Les photos sont gardées d’origine (EXIF intact) ; la météo du jour vient de l’archive Open-Meteo, à titre indicatif. Le PDF part à la FDC ou à l’assureur.'
  ]},
  fuel: {match: /^Carburant GNR|^Plein d|^Cuve de GNR|^Remboursement TICPE/i, title: 'Carburant GNR', points: [
    'Notez chaque livraison dans la cuve (litres, prix, facture) et chaque plein d’engin avec le compteur horaire.',
    'La consommation l/h se calcule de plein à plein ; une alerte signale une dérive de +20 % par rapport à la moyenne de l’engin.',
    'Le niveau de cuve est estimé à partir de la dernière jauge ; le remboursement TICPE est un montant estimé, pas une déclaration.'
  ]},
  'campaign-history': {match: /^Historique des campagnes/i, title: 'Historique des campagnes', points: [
    'Marge ou charges €/ha sur 3 à 5 campagnes, par culture ou par parcelle, avec la culture de l’assolement de chaque année.',
    'La moyenne olympique retire la meilleure et la pire année : une référence utile pour l’assurance récolte.',
    'Les parcelles sous la moyenne de l’exploitation plus d’une année sur deux sont signalées.'
  ], tip: 'Astuce : touchez une valeur pour ouvrir les marges de cette campagne.'},
  'accounting-export': {match: /^Pour mon comptable/i, title: 'Pour mon comptable', points: [
    'Une ligne par opération chiffrée : factures émises, ventes de récolte et d’animaux, entrées de stock, pleins de GNR et entretiens, avec compte, parcelle, culture, HT, TVA et TTC.',
    'Le classeur Excel ajoute les ventes, une synthèse par compte et taux de TVA, et les stocks valorisés à la date de clôture.',
    'C’est une aide, pas une comptabilité légale ni un FEC : comptes indicatifs, taux de TVA à saisir par catégorie.'
  ]},
  'net-margin': {match: /^Marge nette/i, title: 'Marge nette', points: [
    'Trois étages : marge brute, marge directe après matériel, puis marge nette après fermages, charges de structure et aides.',
    'Les fermages viennent du foncier (bail et indice) ; charges et aides se saisissent une fois par campagne, réparties au prorata des hectares ou affectées à une culture.',
    'Les aides sont des montants estimés, non contractuels : vérifiez-les sur votre relevé PAC.'
  ], tip: 'Astuce : « Reprendre » recopie la fiche de la campagne précédente, à ajuster.'},
  'machine-costs': {match: /^Coût réel du matériel/i, title: 'Coût réel du matériel', points: [
    'Coût complet de la campagne : amortissement, assurance, entretiens et carburant, divisé par les heures et les hectares des travaux.',
    'Le taux de complétude indique la part des travaux avec heures : un travail sans heures fait monter le €/h.',
    'Le barème d’entraide ou CUMA est le vôtre (millésime et source) ; le coût horaire saisi ou le tarif d’un client ne changent qu’après confirmation.'
  ], tip: 'Astuce : un engin sous-utilisé coûte souvent plus cher qu’une ETA ; comparez au barème.'},
  forage: {match: /^Bilan fourrager|^Récolte de fourrage|^Inventaire de fourrage|^Besoins d’hivernage/i, title: 'Bilan fourrager', points: [
    'Saisissez chaque récolte (balles, silo ou tonnes) : elle est convertie en tonnes de matière sèche avec un taux de MS modifiable.',
    'Les besoins se calculent avec les lots à nourrir (effectif × kg MS par jour) sur la période d’hivernage ; un inventaire remet le stock à jour.',
    'Le calendrier de coupe compare les sommes de températures depuis le 1er février à des repères indicatifs : le stade réel de la prairie prime.'
  ]},
  seeds: {match: /^Mes variétés/i, title: 'Mes variétés', points: [
    'Dans un travail de semis, la section « Semence » note la variété (liste apprise), la densité, le PMG, le lot, l’origine et le traitement de semence.',
    'La dose en kg/ha se calcule à partir des grains/m² et du PMG ; la fiche parcelle affiche le semis de la campagne.',
    'Le tableau croise variété, date de semis, rendement des lots de récolte et coût semence sur plusieurs campagnes ; les semences de ferme sont totalisées pour la CVO.'
  ]},
  'soil-analysis': {match: /^Analyses? de sol|^Modifier l’analyse de sol|^Plan de chaulage|^Grille d’échantillonnage|^Guidage échantillonnage/i, title: 'Analyses de sol', points: [
    'Saisissez les résultats du laboratoire (pH, P₂O₅, K₂O, MgO, MO, CEC) et joignez le bulletin PDF ; une alerte signale les analyses de plus de 5 ans.',
    'Le besoin de chaulage est estimé selon la texture et le pH cible, puis peut créer une tâche ; c’est un calcul indicatif à valider avec votre conseiller.',
    'La grille place environ un point par hectare dans le contour, en zigzag ; le guidage GPS mène d’un point au suivant sur le terrain.'
  ]},
  hedges: {match: /^Haies et IAE|^Nouvelle infrastructure|^Modifier l’infrastructure|^Règles BCAE 8/i, title: 'Haies et IAE', points: [
    'Tracez haies, alignements et bandes tampons sur la carte (linéaire calculé), les bosquets et mares en contour, ou placez un arbre ou une mare avec votre position.',
    'Le compteur donne les km de haies et la part de SAU en IAE avec les coefficients de pondération, modifiables dans « Règles BCAE 8 ».',
    'Un travail de taille de haie daté du 16 mars au 15 août est bloqué avec une explication, sauf dérogation cochée ; les dates se paramètrent selon votre département.'
  ]},
  simulator: {match: /^Et si/i, title: 'Simulateur « Et si… »', points: [
    'Les curseurs font varier le rendement, le prix, les engrais et le GNR : la marge se recalcule aussitôt.',
    'La matrice croise rendement et prix pour voir où la marge devient négative.',
    'C’est une simulation : rien n’est enregistré, et les hypothèses sont rappelées à l’écran.'
  ]},
  'phyto-register': {match: /^Registre phyto/i, title: 'Registre phyto', points: [
    'Chaque traitement saisi dans un travail rejoint le registre de la campagne.',
    'Avant de valider, Parcelles compare la dose, le nombre de passages, le DAR et la ZNT à la fiche du produit.',
    'Le registre s’exporte en PDF ou en tableur pour un contrôle. Les contrôles sont indicatifs : l’étiquette du produit fait foi.'
  ], link: {label: 'Catalogue des produits', action: 'open-phyto-catalog'}, tip: 'Astuce : renseignez le numéro AMM, la fiche produit se remplit seule.'},
  'phyto-catalog': {match: /^Catalogue phyto/i, title: 'Catalogue des produits', points: [
    'Importez une fois le fichier E-Phy : il reste disponible sans réseau au champ.',
    'Cherchez par nom ou numéro AMM pour retrouver doses, délais avant récolte et zones non traitées.',
    'Un produit retiré du marché est signalé. Vérifiez toujours la date du fichier importé.'
  ], link: {label: 'Registre phyto', action: 'open-phyto-register'}, tip: 'Astuce : refaites l’import E-Phy à chaque début de campagne.'},
  ift: {match: /^Indice de fréquence/i, title: 'IFT', points: [
    'L’IFT compte les doses de référence appliquées, par parcelle, culture et campagne.',
    'Comparez vos cultures entre elles et d’une campagne à l’autre.',
    'Le calcul est indicatif : les doses de référence viennent de la table datée affichée.'
  ], link: {label: 'Registre phyto', action: 'open-phyto-register'}, tip: 'Astuce : la carte peut se colorer selon l’IFT (Couches › couleur).'},
  nitrogen: {match: /^(Azote|Références azote)/i, title: 'Azote et plan de fumure', points: [
    'Préparez le plan prévisionnel de fumure de chaque parcelle avant les apports.',
    'Les apports saisis dans les travaux remplissent le cahier d’enregistrement.',
    'Les alertes (zone vulnérable, périodes d’interdiction, 170 kg N organique) sont indicatives : vérifiez l’arrêté de votre département.'
  ], link: {label: 'Conformité', action: 'open-compliance'}, tip: 'Astuce : saisissez l’objectif de rendement, le besoin en azote se calcule seul.'},
  pac: {match: /^Assistant PAC/i, title: 'Assistant PAC', points: [
    'Retrouvez, îlot par îlot, ce qu’il faut recopier dans Telepac.',
    'Le contrôle de la rotation (BCAE 7) et l’éco-régime sont des simulations à vérifier.',
    'La déclaration officielle se fait toujours sur Telepac.'
  ], link: {label: 'Assolement', action: 'open-rotations'}, tip: 'Astuce : la carte peut afficher les parcelles à risque BCAE 7.'},
  covers: {match: /^(Couverts|Réglages des couverts)/i, title: 'Couverts et intercultures', points: [
    'Notez le couvert semé après la récolte, avec ses dates de semis et de destruction.',
    'Parcelles rappelle les dates de destruction autorisées selon vos réglages.',
    'Les dates sont indicatives : la règle de votre département fait foi.'
  ], link: {label: 'Assolement', action: 'open-rotations'}, tip: 'Astuce : un couvert se saisit aussi depuis l’assolement.'},
  grazing: {match: /^(Animaux au pré|Déplacer le lot)/i, title: 'Pâturage', points: [
    'Mettez un lot au pré en indiquant la parcelle, les animaux et la date d’entrée.',
    'Le nombre de jours au pré et la charge s’affichent sur la carte et l’accueil.',
    '« Déplacer le lot » ferme la parcelle quittée et ouvre la suivante en un geste.'
  ], link: {label: 'Mettre un lot au pré', action: 'new-grazing'}, tip: 'Astuce : la frise de pâturage de chaque parcelle montre les rotations passées.'},
  'public-works': {match: /^Travaux publics/i, title: 'Travaux publics', points: [
    'Un chantier regroupe engins, heures et quantités pour un client.',
    'Les heures saisies au fil des jours préparent la facture.',
    'Exportez le récapitulatif du chantier en PDF ou en tableur.'
  ], link: {label: 'Factures', action: 'open-invoices'}, tip: 'Astuce : dupliquez une journée pour aller plus vite.'},
  'team-work': {match: /^(Consignes & heures|Confier un travail|Feuille d’heures)/i, title: 'Consignes et heures', points: [
    'Confiez un travail à un salarié : il le voit sur son téléphone avec les consignes.',
    'Chacun pointe ses heures ; la feuille d’heures se prépare seule.',
    'Il faut que l’exploitation soit partagée dans « Équipe et autorisations ».'
  ], link: {label: 'Équipe et autorisations', action: 'open-team-roles'}, tip: 'Astuce : une consigne peut contenir une photo ou un point sur la carte.'},
  'day-route': {match: /^(Ma tournée du jour|Récapitulatif de la journée)/i, title: 'Tournée du jour', points: [
    '« Démarrer ma journée » enchaîne travaux, tâches et lots à déplacer dans l’ordre le plus court.',
    'À chaque étape : Y aller, Commencer, Fini.',
    'Le soir, un récapitulatif reprend ce qui a été fait et ce qui reste.'
  ], link: {label: 'Mode terrain', action: 'open-field-mode'}, tip: 'Astuce : la tournée fonctionne sans réseau une fois la carte chargée.'},
  compliance: {match: /^(Prêt pour un contrôle|Certiphyto|Contrôle du pulvérisateur|Réglages de la conformité)/i, title: 'Prêt pour un contrôle ?', points: [
    'Une liste des pièces souvent demandées lors d’un contrôle : registre, Certiphyto, pulvérisateur…',
    'Chaque ligne indique ce qui manque et où le compléter.',
    'C’est une aide indicative : elle ne remplace pas les textes officiels.'
  ], link: {label: 'Registre phyto', action: 'open-phyto-register'}, tip: 'Astuce : notez la date de fin du Certiphyto pour être prévenu à temps.'},
  automations: {match: /^(Automatisations|Test de la règle|Test de l’automatisation)/i, title: 'Automatisations', points: [
    'Une règle « Si… alors… » agit à votre place, par exemple créer une tâche quand un stock baisse.',
    'Testez une règle avant de l’activer : rien n’est modifié pendant le test.',
    'Une règle ne fait que les actions que vous avez choisies.'
  ], link: {label: 'Stocks', action: 'open-stock'}, tip: 'Astuce : partez d’un modèle prêt à l’emploi.'},
  satellite: {match: /^(Satellite|Connexion satellite)/i, title: 'Images satellite', points: [
    'L’indice de végétation (NDVI) montre les zones plus ou moins vigoureuses d’une parcelle.',
    'Les nuages masquent parfois l’image : comparez plusieurs dates.',
    'Une connexion Internet est nécessaire pour charger de nouvelles images.'
  ], tip: 'Astuce : la courbe NDVI de la fiche parcelle résume toute la saison.'},
  search: {match: /^Recherche$/i, title: 'Recherche et questions', points: [
    'Cherchez une parcelle, un travail, un produit ou un outil.',
    'Posez une question simple : « combien d’azote sur le blé cette campagne ? ».',
    'Le détail du calcul est affiché et s’exporte en tableur.'
  ], tip: 'Astuce : sur ordinateur, Ctrl K (ou Cmd K) ouvre la recherche.'},
  rotations: {match: /^(Assolement|Planifier la campagne)/i, title: 'Assolement', points: [
    'Voyez la surface de chaque culture et la rotation de chaque parcelle.',
    'Préparez la campagne suivante sans toucher à celle en cours.',
    'Les couverts d’interculture se notent ici aussi.'
  ], link: {label: 'Assistant PAC', action: 'open-pac'}, tip: 'Astuce : l’anneau d’assolement se touche pour isoler une culture.'},
  'data-center': {match: /^(Mes données|Sauvegardes automatiques|Restaurer la sauvegarde|Sauvegarde)/i, title: 'Mes données', points: [
    'Importez vos parcelles (PAC, SHP, Excel) et retrouvez la corbeille.',
    'Faites régulièrement une sauvegarde hors du téléphone : clé USB, ordinateur ou messagerie.',
    'Une sauvegarde restaurée remplace les données de cet appareil : vérifiez sa date.'
  ], link: {label: 'Sauvegarder maintenant', action: 'backup-now'}, tip: 'Astuce : la sauvegarde chiffrée protège vos données par un mot de passe.'},
  sync: {match: /^(Synchronisation|Compte & équipe|Sécurité & synchronisation|Conflit de synchronisation)/i, title: 'Synchronisation', points: [
    'Avec un compte, vos saisies passent d’un appareil à l’autre dès que le réseau revient.',
    'Sans réseau, tout est gardé sur l’appareil et envoyé plus tard.',
    'Si deux personnes modifient la même fiche, Parcelles vous demande laquelle garder.'
  ], link: {label: 'Équipe et autorisations', action: 'open-team-roles'}, tip: 'Astuce : la pastille en haut de l’écran indique si tout est envoyé.'},
  activity: {match: /^Activité$/i, title: 'Activité', points: [
    'Toutes les modifications, de cet appareil et de l’équipe, du plus récent au plus ancien.',
    'Filtrez par personne, appareil, parcelle, type ou période.',
    'Touchez une ligne pour ouvrir la fiche concernée et son historique.'
  ], tip: 'Astuce : l’export PDF « Registre des modifications » garde une trace datée des changements.'},
  trash: {match: /^(Corbeille|Vider la corbeille|Restaurer aussi)/i, title: 'Corbeille', points: [
    'Les éléments supprimés y restent jusqu’à ce que vous la vidiez.',
    'Filtrez par type ou cherchez un nom ; chaque ligne indique quand et par qui l’élément a été supprimé.',
    'En restaurant une parcelle, Parcelles propose aussi ses travaux et passages supprimés le même jour.'
  ], link: {label: 'Sauvegarde complète', action: 'export-complete-backup'}, tip: 'Astuce : dans une exploitation partagée, seule la personne propriétaire peut vider la corbeille.'},
  telepac: {match: /^Importer depuis telepac/i, title: 'Import telepac', points: [
    'Sur telepac : Déclaration › Téléchargements › « Parcelles graphiques (SHP) ». Gardez le ZIP tel quel.',
    'Parcelles reconnaît le fichier : nom « îlot.parcelle » (ex. 3.2), culture d’après le code PAC, surface admissible.',
    'L’année suivante, réimportez : l’aperçu liste les nouvelles parcelles, les découpes et les cultures changées.'
  ], link: {label: 'Historique des imports', action: 'open-import-history'}, tip: 'Astuce : le numéro PACAGE n’est jamais enregistré, et chaque import peut être annulé.'},
  'parcel-check': {match: /^Vérification du parcellaire/i, title: 'Vérification du parcellaire', points: [
    'Repère les parcelles qui se chevauchent et la surface comptée deux fois.',
    'Signale les écarts de plus de 2 % entre surface saisie, surface du contour, surface déclarée (telepac) et RPG.',
    'Avec le RPG chargé (connexion nécessaire), indique les parcelles découpées autrement dans le RPG.'
  ], link: {label: 'Assistant PAC', action: 'open-pac'}, tip: 'Astuce : c’est une aide calculée par approximation ; la déclaration telepac reste la référence.'},
  regulatory: {match: /^Valeurs réglementaires indicatives/i, title: 'Couches réglementaires', points: [
    'Carte › Couches › Réglementaire : cours d’eau BCAE, hydrographie, Natura 2000, zones vulnérables et pentes (services publics IGN et Sandre).',
    'La fiche parcelle indique le cours d’eau le plus proche et les sites Natura 2000 ; hors connexion, la dernière évaluation reste affichée.',
    'Une préconisation peut exclure une bande le long des cours d’eau : dose 0 dans l’export ISOXML ou SHP.'
  ], tip: 'Astuce : la ZNT dépend du produit (AMM) et de l’arrêté départemental ; ajustez ici les valeurs indicatives.'},
  'regulated-ops': {match: /^Opérateurs et échéances/i, title: 'Opérateurs et échéances', points: [
    'Une fiche par opérateur : nom, n° Certiphyto, catégorie (décideur ou opérateur) et fin de validité.',
    'Un traitement saisi avec un opérateur sans Certiphyto valide affiche un avertissement.',
    'Contrôle du pulvérisateur, assurances et conseil stratégique : rappel sur l’accueil 60 jours avant l’échéance (réglable).'
  ], link: {label: 'Conformité', action: 'open-compliance'}, tip: 'Astuce : les périodicités sont indicatives et modifiables ; l’échéance d’assurance se saisit sur la fiche du matériel.'},
  'app-lock': {match: /^Verrouillage de Parcelles/i, title: 'Verrouillage', points: [
    'Parcelles demande un code après quelques minutes sans utilisation.',
    'Face ID ou l’empreinte peuvent remplacer le code ; le code reste toujours possible.',
    'C’est une protection de l’écran, pas un chiffrement : pour un fichier protégé, faites une sauvegarde chiffrée.'
  ], link: {label: 'Mes données', action: 'open-data-center'}, tip: 'Astuce : notez votre code en lieu sûr.'},
  stock: {match: /^(Stocks|Mouvement de stock)/i, title: 'Stocks', points: [
    'Suivez semences, engrais et produits : entrées, sorties et valeur.',
    'Un seuil d’alerte prévient avant la rupture.',
    'Les produits utilisés dans un travail sortent du stock.'
  ], tip: 'Astuce : un QR code sur l’étagère ouvre directement le mouvement de stock.'},
  equipment: {match: /^Matériel$/i, title: 'Matériel', points: [
    'Notez compteurs, pleins et entretiens de chaque engin.',
    'Les coûts du matériel se reportent sur les travaux.',
    'Un rappel prévient avant l’entretien suivant.'
  ], tip: 'Astuce : collez un QR code sur l’engin pour saisir les heures en un scan.'},
  weather: {match: /^Météo/i, title: 'Météo', points: [
    'Prévisions pour l’exploitation et pour chaque parcelle.',
    'Les créneaux favorables (vent, pluie, Delta T) sont indicatifs.',
    'La météo demande du réseau ; la dernière prévision reste affichée sans réseau.'
  ], tip: 'Astuce : réglez vos seuils de vent et de pluie dans Paramètres.'},
  'work-list': {title: 'Liste des travaux', points: [
    'Tous les travaux, à faire et faits, avec filtres par parcelle et par type.',
    'Cochez un travail pour le marquer fait ; « Annuler » reste possible.',
    '« Refaire ce travail » crée une copie préremplie.'
  ], link: {label: 'Nouveau travail', action: 'new-work'}},
  'work-week': {title: 'Semaine', points: [
    '« Organise ma semaine » propose un planning selon la météo, la proximité et le matériel.',
    'Appliquez la proposition en un geste, ou ajustez-la jour par jour.',
    'Tout se défait avec « Annuler ».'
  ], link: {label: 'Météo', action: 'open-weather'}},
  'work-calendar': {title: 'Calendrier', points: [
    'Les travaux et tâches posés sur les jours du mois.',
    'Touchez un jour pour voir le détail ou ajouter un travail.',
    'Ajoutez un travail à votre agenda de téléphone avec « Ajouter à mon agenda ».'
  ]},
  'work-tasks': {title: 'Tâches', points: [
    'Les rappels qui ne sont pas des travaux de parcelle : clôture, commande, rendez-vous.',
    'Donnez une échéance pour les voir sur l’accueil.',
    'Une tâche peut être liée à une parcelle.'
  ], link: {label: 'Nouvelle tâche', action: 'new-task'}},
  'work-chantiers': {title: 'Chantiers', points: [
    'Un chantier regroupe un même travail sur plusieurs parcelles.',
    'Suivez l’avancement parcelle par parcelle.',
    'Les surfaces et les temps s’additionnent seuls.'
  ]}
};

export function helpKeyFor(title) {
  const text = String(title || '').trim();
  if (!text) return '';
  for (const [key, entry] of Object.entries(HELP)) if (entry.match?.test(text)) return key;
  return '';
}
export function helpEntry(key) { return HELP[key] || null; }

// Astuce à montrer si elle n'a pas déjà été vue (preferences.seenTips : liste de clés).
export function tipToShow(key, seenTips) {
  const entry = HELP[key];
  if (!entry?.tip) return '';
  return (Array.isArray(seenTips) ? seenTips : []).includes(key) ? '' : entry.tip;
}
export function markTipSeen(seenTips, key) {
  const list = Array.isArray(seenTips) ? seenTips.filter(item => typeof item === 'string' && HELP[item]) : [];
  return list.includes(key) || !HELP[key] ? list : [...list, key];
}

export const FAQ = [
  {q: 'Je change de téléphone', a: 'Sur l’ancien téléphone : Plus › Mes données › Sauvegarde complète, puis envoyez le fichier sur le nouveau (messagerie, câble, clé). Sur le nouveau : installez Parcelles, puis Mes données › Restaurer. Avec un compte, il suffit de vous connecter : tout revient.'},
  {q: 'Pas de réseau au champ', a: 'Saisissez normalement : tout est gardé dans le téléphone. Sans réseau, seules la météo, la carte PAC, les images satellite et l’envoi vers les autres appareils attendent. Ils reprennent seuls quand le réseau revient.'},
  {q: 'Qui voit mes données ?', a: 'Sans compte, personne : elles restent dans ce téléphone. Avec un compte, seules les personnes que vous invitez voient l’exploitation, avec le rôle que vous leur donnez. Le GPS ne sert que quand vous le demandez.'}
];
