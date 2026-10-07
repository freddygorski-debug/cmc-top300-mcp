# Scanner simplifiÃ© â€” entry-v6 (candidat local, non dÃ©ployÃ©)

Le prompt SCAN_PROMPT_V2.md dÃ©crit cette version de travail, issue du Scan 5 % personnel.
Production conservÃ©e : entry-v5, commit 9414c22. Aucun secret, route ou configuration rÃ©seau modifiÃ©.

## Trois dÃ©cisions techniques

1. Reprise ou cassure : support = dernier creux local confirmÃ© dans les quatre derniÃ¨res mesures historiques ; le prix courant peut confirmer le dernier creux, mais aucune donnÃ©e future n'est utilisÃ©e. Un nouveau creux supÃ©rieur remplace l'ancien plus bas horaire. Le minimum des cinq prix de la derniÃ¨re heure sert seulement de repli pour une base sans creux rÃ©cent confirmÃ©. Une reprise aprÃ¨s ce creux ou une sortie du plafond des quatre prix prÃ©cÃ©dents peut dÃ©clencher l'examen. Une petite baisse live est tolÃ©rÃ©e jusqu'Ã  0,15 % uniquement si le dernier Ã©chantillon avait montÃ©. Aucun rejet automatique de toute bougie historique rouge.
2. Risque : zone Â±0,15 %, stop sous support avec marge entre 0,2 et 0,4 % suivant le bruit mÃ©dian ; risque maximum 2 % depuis le haut de zone. Aucune extension forcÃ©e du stop.
3. Potentiel : cible +2,55 % depuis haut de zone, avant une rÃ©sistance significative (sommet ayant causÃ© au moins 1 % de repli jusqu'au premier creux suivant ; Ã  dÃ©faut, repli dÃ©jÃ  observÃ© aprÃ¨s ce sommet). Les petites oscillations ne deviennent plus automatiquement des barriÃ¨res.

Sans rÃ©sistance supÃ©rieure, une projection doit Ãªtre justifiÃ©e par une vague low-high-low dÃ©jÃ  achevÃ©e : amplitude â‰¥2,805 %, creux suivant supÃ©rieur au creux initial et support actuel au moins Ã©gal au creux suivant. Le repli achevÃ© doit Ãªtre â‰¥0,5 %. La nouvelle avance ne doit pas consommer plus de 35 % de cette amplitude. La limite uniforme de 1,2 % et la limite d'Ã©cart entre live et dernier Ã©chantillon sont supprimÃ©es. Les exigences de risque et de potentiel restent.

Un support infÃ©rieur au creux local prÃ©cÃ©dent dans une structure quatre heures nÃ©gative invalide la reprise. Cela est un contrÃ´le de rupture de structure, pas un veto fondÃ© uniquement sur une variation horaire ou quotidienne.

Ces seuils constituent une premiÃ¨re traduction explicite et provisoire ; ils ne sont pas statistiquement calibrÃ©s. Une projection de vague ne dÃ©montre pas qu'une nouvelle vague atteindra l'objectif.

## Infrastructure et couverture

SÃ©lection simplifiÃ©e localement : Top 300, non-stablecoins, volume â‰¥5 M USD/24 h, listing frais â‰¤20 min ; dix historiques, dont quatre places de rotation, jusqu'Ã  quatre prioritÃ©s de reprises et jusqu'Ã  deux indices de stabilisation aprÃ¨s un listing baissier (variation rÃ©cente absolue â‰¤0,2 %). Une grande variation rÃ©cente >1 % n'est plus prioritaire devant une reprise modÃ©rÃ©e simplement parce qu'elle suit une baisse. Les places libres sont complÃ©tÃ©es par rotation. Le radar reste silencieux mais son anciennetÃ© ne donne plus un droit Ã  une place. Ces indices de listing ne sont ni une base confirmÃ©e ni une entrÃ©e et ne prouvent pas une amÃ©lioration de couverture.

Contexte : 4,5 heures Ã  15m, minimum 17 prix continus, dernier point â‰¤20 min. Pendant 9â€“23 Paris, une requÃªte groupÃ©e lit au maximum sept prix 5m par actif (count=7, time_end=now). Minimum six points continus, dernier point â‰¤10 min ; quote rÃ©cente â‰¤5 min et pas antÃ©rieure au dernier point court. Aucun comblement de trous ni retour silencieux Ã  15m si la sÃ©rie courte est invalide. Nuit : aucune requÃªte 5m. Cron inchangÃ© Ã  15m.

Les niveaux utilisent les prix 15m antÃ©rieurs au dÃ©but de la sÃ©rie courte, puis les prix 5m observÃ©s. Le support et la reprise viennent des prix courts ; variations 1h/4h et bruit mÃ©dian restent fondÃ©s sur les prix 15m. Si le dernier prix 5m est plus rÃ©cent que le listing, il sert Ã  la dÃ©cision initiale ; la quote finale reste relue aprÃ¨s les analyses. Les deux sÃ©ries sont conservÃ©es dans l'audit. Une erreur 5m identifie l'intervalle et bloque les notifications.

Le contexte quotidien, BTC/ETH, volume roulant et actualitÃ©s enrichissent l'analyse sans veto automatique de baisse du volume. Plancher absolu conservÃ©. Estimation 13 950 crÃ©dits/mois sur 31 jours, 96 scans/jour, un crÃ©dit 5m sur les 56 scans diurnes et dix quotes finales/jour ; hors appels manuels. Les crÃ©dits sont auditÃ©s, ce calcul n'est pas un plafond mensuel implÃ©mentÃ©.

Avant envoi : nouvelle quote, mÃªme configuration, prix dans la zone initiale et plan toujours valide ; contrÃ´le du plancher de volume Ã©galement sur la quote finale. Aucun Ã©largissement de zone. Un petit recul dans la zone reste possible. Une quote isolÃ©e ne prouve pas une pente Ã  cinq minutes.

Protections inchangÃ©es : 9â€“23 Paris/DST, deux tentatives/run, dix/jour, dix quotes finales/jour, cooldown deux heures/actif et dÃ©duplication du support, rÃ©servation avant envoi incertain, pas de queue nocturne, pas de suivi/position/renforcement/expiration quatre heures. CMC, Cloudflare, Telegram et secrets rÃ©utilisÃ©s.

## Ã‰valuation

65 tests rÃ©ussis, TypeScript et diff vÃ©rifiÃ©s. Tests couvrant petite respiration, vraie baisse, rupture du creux, rÃ©sistance mineure/significative, risque, donnÃ©es pÃ©rimÃ©es, relecture du prix et du volume avant envoi, absence de doublons et de suivi, limites quotidiennes et heures. Le test de support dÃ©montre qu'un creux supÃ©rieur confirmÃ© remplace l'ancien plancher horaire sans Ã©largir le risque. Le test de prÃ©sÃ©lection vÃ©rifie les places de stabilisation, l'absence de prioritÃ© de l'ancien radar et la comparaison de listings rÃ©ellement renouvelÃ©s. Il ne mesure pas l'efficacitÃ© sur les 300 actifs en production.

Replay Ã©largi demandÃ© par l'utilisateur : 26 sÃ©ries sur 25 actifs distincts, 977 dÃ©cisions Ã©ligibles par version. Production zÃ©ro signal ; premier brouillon un PUMP invalidÃ© ; brouillon corrigÃ© trois signaux dont un RAY avec objectif observÃ© et deux invalidÃ©s. Tous les signaux se situent dans les sept historiques initiaux ; douze actifs nouveaux choisis par rang avant lecture des rÃ©sultats et sept sÃ©ries d'archives ne donnent aucun signal. MÃªme proxy de quote, mÃªmes horaires et dedupe. DonnÃ©es quotidiennes historiques et contexte BTC manquants omis dans les versions. Ni prÃ©sÃ©lection globale ni exÃ©cution Neverless reproduites. RÃ©sultats enregistrÃ©s avec hash des trois moteurs dans outputs/simplified-expanded-comparison.json du workspace parent.

Quatre heures = fenÃªtre d'Ã©valuation uniquement, jamais durÃ©e de dÃ©tention imposÃ©e. Ce test sur une seule journÃ©e utilisÃ©e pendant le dÃ©veloppement ne prouve pas un bÃ©nÃ©fice ; ne pas dÃ©ployer sur la base de ce rÃ©sultat. Plus de cohÃ©rence textuelle n'Ã©quivaut pas Ã  une meilleure performance.

Artifacts de recherche locaux : outputs/replay-simplified-expanded.cjs, outputs/simplified-expanded-comparison.json et les quatre jeux de donnÃ©es Ã©numÃ©rÃ©s par ce script dans le workspace parent. RÃ©fÃ©rences figÃ©es : production 9414c22, premier brouillon 8eba19a ; hash du moteur corrigÃ© enregistrÃ©. La comparaison prÃ©cÃ©dente reste archivÃ©e et ne dÃ©crit pas ce nouveau moteur.
