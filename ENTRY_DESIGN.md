# Scanner simplifié — entry-v6 (candidat local, non déployé)

Le prompt SCAN_PROMPT_V2.md décrit cette version de travail, issue du Scan 5 % personnel.
Production conservée : entry-v5, commit 9414c22. Aucun secret, route ou configuration réseau modifié.

Outil de lecture ajouté pour les comparaisons en prévisualisation : get_cmc_intraday_5m (jusqu'à dix IDs, une heure par défaut, vingt-quatre maximum). Il reprend le même endpoint CMC et ne déclenche ni scan ni message Telegram. Les outils existants sont conservés. Une variation calculée est absente (null) en cas d'intervalle manquant plutôt que d'être présentée comme une variation cinq minutes.

## Trois décisions techniques

1. Reprise ou cassure : support = dernier creux local confirmé dans les quatre dernières mesures historiques ; le prix courant peut confirmer le dernier creux, mais aucune donnée future n'est utilisée. Un nouveau creux supérieur remplace l'ancien plus bas horaire. Le minimum des cinq prix de la dernière heure sert seulement de repli pour une base sans creux récent confirmé. Une reprise après ce creux ou une sortie du plafond des quatre prix précédents peut déclencher l'examen. Une petite baisse live est tolérée jusqu'à 0,15 % si le dernier échantillon avait monté ou si la reprise courte reste positive depuis son premier prix et supérieure de 0,15 % au support récent. Une continuation courte peut qualifier sans creux nouvellement confirmé ; le message la nomme continuation, pas nouveau départ. Aucun rejet automatique de toute bougie historique rouge.
2. Risque : zone ±0,15 %, stop sous support avec marge entre 0,2 et 0,4 % suivant le bruit médian ; risque maximum 2 % depuis le haut de zone. Aucune extension forcée du stop.
3. Potentiel : cible +2,55 % depuis haut de zone, avant une résistance significative (sommet ayant causé au moins 1 % de repli jusqu'au premier creux suivant ; à défaut, repli déjà observé après ce sommet). Les petites oscillations ne deviennent plus automatiquement des barrières.

Sans résistance supérieure, une projection doit être justifiée par une vague low-high-low déjà achevée : amplitude ≥2,805 %, creux suivant supérieur au creux initial et support actuel au moins égal au creux suivant. Le repli achevé doit être ≥0,5 %. La nouvelle avance ne doit pas consommer plus de 35 % de cette amplitude. La limite uniforme de 1,2 % et la limite d'écart entre live et dernier échantillon sont supprimées. Les exigences de risque et de potentiel restent.

Un support inférieur au creux local précédent reste rejeté si le prix courant ne dépasse pas les deux prix précédant le dernier échantillon court. La variation sur quatre heures ne commande plus ce rejet. Risque, support, fraîcheur et marge vers l’objectif restent obligatoires.

Ces seuils constituent une première traduction explicite et provisoire ; ils ne sont pas statistiquement calibrés. Une projection de vague ne démontre pas qu'une nouvelle vague atteindra l'objectif.

## Infrastructure et couverture

Sélection simplifiée localement : Top 300, non-stablecoins, volume ≥5 M USD/24 h, listing frais ≤20 min ; dix historiques, dont quatre places de rotation, jusqu'à quatre priorités de reprises et jusqu'à deux indices de stabilisation après un listing baissier (variation récente absolue ≤0,2 %). Une grande variation récente >1 % n'est plus prioritaire devant une reprise modérée simplement parce qu'elle suit une baisse. Les places libres sont complétées par rotation. Le radar reste silencieux mais son ancienneté ne donne plus un droit à une place. Ces indices de listing ne sont ni une base confirmée ni une entrée et ne prouvent pas une amélioration de couverture.

Contexte : 4,5 heures à 15m, minimum 17 prix continus, dernier point ≤20 min. Pendant 9–23 Paris, une requête groupée lit au maximum sept prix 5m par actif (count=7, time_end=now). Minimum six points continus, dernier point ≤10 min ; quote récente ≤5 min et pas antérieure au dernier point court. Aucun comblement de trous ni retour silencieux à 15m si la série courte est invalide. Nuit : aucune requête 5m. Cron inchangé à 15m.

Les niveaux utilisent les prix 15m antérieurs au début de la série courte, puis les prix 5m observés. Le support et la reprise viennent des prix courts ; variations 1h/4h et bruit médian restent fondés sur les prix 15m. Si le dernier prix 5m est plus récent que le listing, il sert à la décision initiale ; la quote finale reste relue après les analyses. Les deux séries sont conservées dans l'audit. Une erreur 5m identifie l'intervalle et bloque les notifications.

Le contexte quotidien, BTC/ETH, volume roulant et actualités enrichissent l'analyse sans veto automatique de baisse du volume. Plancher absolu conservé. Estimation 13 950 crédits/mois sur 31 jours, 96 scans/jour, un crédit 5m sur les 56 scans diurnes et dix quotes finales/jour ; hors appels manuels. Les crédits sont audités, ce calcul n'est pas un plafond mensuel implémenté.

Avant envoi : nouvelle quote, même configuration, prix dans la zone initiale et plan toujours valide ; contrôle du plancher de volume également sur la quote finale. Aucun élargissement de zone. Un petit recul dans la zone reste possible. Une quote isolée ne prouve pas une pente à cinq minutes.

Protections inchangées : 9–23 Paris/DST, deux tentatives/run, dix/jour, dix quotes finales/jour, cooldown deux heures/actif et déduplication du support, réservation avant envoi incertain, pas de queue nocturne, pas de suivi/position/renforcement/expiration quatre heures. CMC, Cloudflare, Telegram et secrets réutilisés.

## Évaluation

67 tests réussis, TypeScript et diff vérifiés. Tests couvrant petite respiration, vraie baisse, rupture du creux, résistance mineure/significative, risque, données périmées, relecture du prix et du volume avant envoi, absence de doublons et de suivi, limites quotidiennes et heures. Le test de support démontre qu'un creux supérieur confirmé remplace l'ancien plancher horaire sans élargir le risque. Le test de présélection vérifie les places de stabilisation, l'absence de priorité de l'ancien radar et la comparaison de listings réellement renouvelés. Il ne mesure pas l'efficacité sur les 300 actifs en production.

Replay élargi demandé par l'utilisateur : 26 séries sur 25 actifs distincts, 977 décisions éligibles par version. Production zéro signal ; premier brouillon un PUMP invalidé ; brouillon corrigé trois signaux dont un RAY avec objectif observé et deux invalidés. Tous les signaux se situent dans les sept historiques initiaux ; douze actifs nouveaux choisis par rang avant lecture des résultats et sept séries d'archives ne donnent aucun signal. Même proxy de quote, mêmes horaires et dedupe. Données quotidiennes historiques et contexte BTC manquants omis dans les versions. Ni présélection globale ni exécution Neverless reproduites. Résultats enregistrés avec hash des trois moteurs dans outputs/simplified-expanded-comparison.json du workspace parent.

Quatre heures = fenêtre d'évaluation uniquement, jamais durée de détention imposée. Ce test sur une seule journée utilisée pendant le développement ne prouve pas un bénéfice ; ne pas déployer sur la base de ce résultat. Plus de cohérence textuelle n'équivaut pas à une meilleure performance.

Artifacts de recherche locaux : outputs/replay-simplified-expanded.cjs, outputs/simplified-expanded-comparison.json et les quatre jeux de données énumérés par ce script dans le workspace parent. Références figées : production 9414c22, premier brouillon 8eba19a ; hash du moteur corrigé enregistré. La comparaison précédente reste archivée et ne décrit pas ce nouveau moteur.

## Comparaison finale du 8 octobre

Sur 104 décisions admissibles des mêmes historiques réels cinq minutes RAY/PUMP : RAY 11:15 Paris objectif 12:50 ; PUMP 09:15 invalidation 11:15 ; PUMP 17:15 objectif 18:10 ; PUMP 20:30 objectif 21:25. Prix échantillonnés CMC, contexte chaque troisième point réel, quote courante simulée, sans présélection Top300 ni limites agrégées ni exécution Neverless. Échantillon déjà examiné, aucune preuve de rentabilité. Dernière fenêtre incomplète mais objectif observé. Aucun message Telegram envoyé pour ces replays.
