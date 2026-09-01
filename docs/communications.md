# Carte des communications

Deux plans étanches. L'orchestrateur est le seul pont.

## Plan IA ↔ IA — contrats JSON sur le board, terse

| Communication | Émetteur → récepteur | Mécanisme | Charge utile |
| --- | --- | --- | --- |
| Délégation | Orchestrateur → dev | `board.mjs delegate` | `task-envelope.schema.json` |
| Compte-rendu | dev/qa → orchestrateur | `board.mjs report` | `report.schema.json` |
| Relais (blocage) | agent ↔ agent | `board.mjs event peer_message` | trace + échange direct |
| État partagé | tous ↔ board | `board.mjs` | `backlog.json` (US) + `board.json` (wip, events) |
| Porte DoD | hook → orchestrateur | `SubagentStop` → `dod-gate.sh` | code sortie 0/2 |
| Apprentissage | retro → futurs agents | `memory: project` | notes persistantes |

Règles : coordination via le board uniquement ; échange direct entre agents
seulement en cas de blocage, **toujours** tracé (`peer_message`) ; le board ne
contient aucune prose humanisée, juste l'essentiel structuré.

## Plan Humain ↔ IA — langage naturel + portes via lavish (souple)

Tu n'utilises **aucune commande**. Tu écris tes besoins ; l'orchestrateur pilote.
Il ne te sollicite qu'aux portes :

| Porte | Échange |
| --- | --- |
| Backlog raffiné | `board/board.html` ↔ priorités/critères ajustés |
| Revue d'archi | `architecture.html` (Mermaid éditable) ↔ frontières |
| Démo / acceptation | « fait vs attendu » ↔ accepté / refusé |
| Blocage | point de blocage ↔ décision |

Mode souple : l'agent ouvre l'artefact, continue, et récupère ton retour au
prochain point de contrôle (`lavish-axi poll`) sans se suspendre. Chaque retour
est journalisé en `human_feedback`.
