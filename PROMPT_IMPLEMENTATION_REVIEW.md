# Correspondance prompt / scanner — révision proposée du 6 octobre 2026

Cette révision est à valider avant fusion et déploiement. Elle corrige des écarts précis, sans prétendre reproduire tout le raisonnement du Scan 5 % ni démontrer une rentabilité.

| Exigence | Écart précédent | Réalisation proposée | Vérification et limites |
|---|---|---|---|
| Chercher tôt | Classement par plus forte hausse sur une heure | Priorité aux variations positives récentes entre listings, surtout après variation négative ; exploration par rotation | Test de reprise face à fortes hausses horaires ; aucun signal de reprise à partir de timestamps inchangés. Un indice de listing ne suffit pas à une entrée. |
| Heure = contexte, pas attente | Veto sur heure non positive | Retirer le veto horaire ; valider la structure récente | Une reprise à creux ascendant avec heure négative peut passer. Aucune attente d'une heure ajoutée. |
| Davantage de couverture | Cinq historiques partagés avec suivis | Dix historiques au total, jusqu'à deux suivis et huit nouveaux si deux suivis présents | Couverture séparée dans les snapshots, quatre places de rotation. Dix nouvelles recherches plus suivis ne sont pas annoncées. |
| Début d'une nouvelle vague | Motif de reprise trop simplifié | Creux actuel supérieur au creux précédent ; limite de 1,2 % d'extension depuis le support ; sortie de base récente étroite | Tests de reprise, recul récent, vague trop avancée et rebond à creux descendant. Seuils provisoires, pas calibrés sur des résultats réels. |
| Escalier haussier | Une hausse déjà faite pouvait justifier le prochain objectif | Jambe antérieure achevée utilisée uniquement pour une projection explicitement incertaine ; structure de creux ascendants | Test synthétique d'escalier. Un objectif fixé à +2,55 % reste conditionnel, pas un gain prédit. |
| Potentiel depuis l'entrée | Hausse actuelle de quatre heures >=2,55 % utilisée comme preuve | Supprimer cette règle ; marge jusqu'au sommet supérieur observé, sinon projection encadrée ou rejet | Les sommets hors des quatre heures trente sont inconnus. Une résistance visible peut être franchie ou échouer. |
| Éviter les envois au retournement | Prix frais comparé au dernier échantillon | Conserver la dernière vérification après les actualités et ajouter le rejet du recul entre les deux derniers échantillons | Tests prix/volume frais ; une pente intraminute et une baisse future restent indétectables. Aucun prix Neverless ni OHLC court ajouté. |
| Expliquer les absences | Seuls certains candidats examinés apparaissaient | Motif de présélection/non-sélection pour chaque actif listé ; motifs techniques et limites d'envoi séparés | Une absence future peut être examinée dans les snapshots ; un passage ancien non conservé ne peut pas être reconstitué. |
| Peu de messages | Risque de répétition des marches | Une entrée par scénario, suivi silencieux et délai de deux heures conservés | Une nouvelle marche pendant un scénario suivi ne produit pas une invitation supplémentaire. Ce compromis limite volontairement les notifications. |

## Budget et compromis

Dix historiques sur six heures auraient augmenté l'estimation de coût. La demande proposée porte sur quatre heures trente, soit environ 19 points par actif et deux crédits d'historique pour environ 190 points. Avec deux crédits pour 300 listings, 96 passages/jour pendant 31 jours et jusqu'à dix vérifications de prix/jour : environ 12 214 crédits. Le credit_count réel est enregistré lorsqu'il est fourni ; le tableau de bord reste à contrôler. Référence officielle : https://coinmarketcap.com/api/resources/what-one-credit-buys-endpoint-by-endpoint/

Ce compromis réduit le contexte détaillé ancien. Les cotations de listing conservent les variations 24 h/7 jours, pas une analyse des bougies de ces horizons. Le scanner peut encore manquer une occasion faute de place, historique incomplet, résistance proche ou limite d'envoi. Aucun quota d'alertes n'est imposé.

## Cas GALA, ZRO et RENDER

Les captures et prix rapportés sont des observations utiles, mais ne contiennent pas les séries CMC USD complètes ni les décisions internes au moment de chaque scan. Les tests introduits sont synthétiques et ne sont pas présentés comme des replays de ces actifs. La cause exacte de GALA/ZRO reste à établir à partir d'éventuelles traces conservées. Aucune donnée future ni conversion EUR/USD supposée n'est utilisée pour faire réussir un exemple.

## Ce qui reste partiel

Les actualités sont facultatives, avec quatre adaptateurs officiels et découverte de presse pour les noms valides ; ni contenu ni lien causal ne sont vérifiés. Les volumes courts, OHLC cinq minutes, cotations exécutables, disponibilité Neverless et situation du portefeuille restent indisponibles. Une évaluation prospective reste nécessaire pour mesurer faux signaux, délai et occasions manquées. Les tests de comportement n'établissent pas l'efficacité financière.
