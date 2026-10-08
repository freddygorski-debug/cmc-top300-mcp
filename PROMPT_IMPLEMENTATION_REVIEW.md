# Prompt / code — version simplifiée locale entry-v6

Statut : proposition du 7 octobre 2026. La production conserve entry-v5. Cette revue remplace la matrice v5 sur cette branche de travail.

| Consigne | Réalisation | Limite |
|---|---|---|
| Nouveau scan du marché | Listing Top 300, dix historiques : rotation, reprises, deux indices de stabilisation ; aucune place privilégiée par ancien radar | Dix analyses détaillées, pas trois cents ; couverture historique globale non rejouée |
| Reprise ou sortie de palier | Dernier creux confirmé récent ; plancher horaire seulement en absence de creux ; reprise au-dessus ou cassure locale | Échantillons 15 min ; aucune pente 5 min |
| Petite respiration admissible | Jusqu'à 0,15 % après un dernier échantillon haussier, prix dans zone initiale avant envoi | Ne prouve pas une poursuite |
| Structure intacte | Rejet de creux inférieur sans reprise locale au-dessus des deux prix précédant le dernier échantillon court | Support échantillonné, pas vrai plus bas OHLC |
| Potentiel restant | Sommet significatif ou vague achevée, projection signalée | Seuils provisoires ; objectif non garanti |
| Invalidation cohérente | Stop sous support, marge bruit, maximum 2 % | Aucune exécution garantie |
| Variations 1 h/24 h/7 j et volume roulant | Contexte conservé dans audit, sans veto quotidien automatique | Volume court indisponible ; floor 5 M USD reste |
| Catalyseurs | Sources déjà configurées, presse et officiel, dates/attribution limitée | Pas de vérification intégrale des articles |
| Cotation finale | Quote relue, même support, zone inchangée, volume ≥5 M USD | Prix CMC non exécutable |
| Une alerte sans suivi | Pas de position, aucun suivi ni renforcement | Cooldown/déduplication conservés |
| Horaires et budget | 9–23 Paris, scan 15 min, caps existants | Quotas peuvent limiter les envois |
| Qualité | 67 tests + TypeScript, replay figé production/brouillon/correction | Trois signaux : un objectif observé, deux invalidations ; présélection modifiée testée fonctionnellement seulement ; aucune efficacité démontrée |

Le texte pose trois questions, mais les seuils nécessaires à leur traduction sont explicités dans ENTRY_DESIGN.md. La nouvelle présélection de configurations, les volumes à cinq minutes et les prix Neverless ne sont pas implémentés ni prétendus disponibles. Ne pas présenter le candidat comme prêt à activer sur le seul fondement des tests logiciels.

Actualisation du 8 octobre : continuation admise sans nouveau creux obligatoire, respiration courte bornée, contexte quatre heures sans veto automatique. Le nouveau replay cinq minutes fournit quatre occasions : trois objectifs observés et une invalidation, sur deux actifs déjà examinés. La comparaison à quinze minutes sur 26 séries reste un objectif et deux invalidations ; elle ne valide pas le bénéfice des données cinq minutes. La lecture réelle de la prévisualisation a réussi après saisie privée du secret CMC par Freddy. Activation de la PR12 toujours soumise à sa validation.
