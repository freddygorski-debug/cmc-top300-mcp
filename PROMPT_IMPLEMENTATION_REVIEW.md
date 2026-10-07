# Prompt / code â€” version simplifiÃ©e locale entry-v6

Statut : proposition du 7 octobre 2026. La production conserve entry-v5. Cette revue remplace la matrice v5 sur cette branche de travail.

| Consigne | RÃ©alisation | Limite |
|---|---|---|
| Nouveau scan du marchÃ© | Listing Top 300, dix historiques : rotation, reprises, deux indices de stabilisation ; aucune place privilÃ©giÃ©e par ancien radar | Dix analyses dÃ©taillÃ©es, pas trois cents ; couverture historique globale non rejouÃ©e |
| Reprise ou sortie de palier | Dernier creux confirmÃ© rÃ©cent ; plancher horaire seulement en absence de creux ; reprise au-dessus ou cassure locale | Ã‰chantillons 15 min ; aucune pente 5 min |
| Petite respiration admissible | Jusqu'Ã  0,15 % aprÃ¨s un dernier Ã©chantillon haussier, prix dans zone initiale avant envoi | Ne prouve pas une poursuite |
| Structure intacte | Rejet si support rompt le creux prÃ©cÃ©dent dans structure quatre heures nÃ©gative | Support Ã©chantillonnÃ©, pas vrai plus bas OHLC |
| Potentiel restant | Sommet significatif ou vague achevÃ©e, projection signalÃ©e | Seuils provisoires ; objectif non garanti |
| Invalidation cohÃ©rente | Stop sous support, marge bruit, maximum 2 % | Aucune exÃ©cution garantie |
| Variations 1 h/24 h/7 j et volume roulant | Contexte conservÃ© dans audit, sans veto quotidien automatique | Volume court indisponible ; floor 5 M USD reste |
| Catalyseurs | Sources dÃ©jÃ  configurÃ©es, presse et officiel, dates/attribution limitÃ©e | Pas de vÃ©rification intÃ©grale des articles |
| Cotation finale | Quote relue, mÃªme support, zone inchangÃ©e, volume â‰¥5 M USD | Prix CMC non exÃ©cutable |
| Une alerte sans suivi | Pas de position, aucun suivi ni renforcement | Cooldown/dÃ©duplication conservÃ©s |
| Horaires et budget | 9â€“23 Paris, scan 15 min, caps existants | Quotas peuvent limiter les envois |
| QualitÃ© | 65 tests + TypeScript, replay figÃ© production/brouillon/correction | Trois signaux : un objectif observÃ©, deux invalidations ; prÃ©sÃ©lection modifiÃ©e testÃ©e fonctionnellement seulement ; aucune efficacitÃ© dÃ©montrÃ©e |

Le texte pose trois questions, mais les seuils nÃ©cessaires Ã  leur traduction sont explicitÃ©s dans ENTRY_DESIGN.md. La nouvelle prÃ©sÃ©lection de configurations, les volumes Ã  cinq minutes et les prix Neverless ne sont pas implÃ©mentÃ©s ni prÃ©tendus disponibles. Ne pas prÃ©senter le candidat comme prÃªt Ã  activer sur le seul fondement des tests logiciels.
