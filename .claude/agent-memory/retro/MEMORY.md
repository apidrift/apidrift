# Memory Index

- [Le board ne s'écrit jamais depuis un worktree](feedback_board_writes.md) — `board/*.json` et `architecture.json` : checkout principal uniquement ; la QA vérifie que `git diff main...<branche> -- board/ architecture/` est VIDE (2 occurrences : US-3, US-8/revert 67331ef).
- [Cadrage sur preuve, pas sur la doc](feedback_cadrage_sur_preuve.md) — un AC qui nomme un artefact vendor est vérifié par l'architecte sur l'artefact réel avant d'atteindre le dev ; lire l'artefact plutôt que maintenir une table (US-9 : `API_VERSION` inexistant, table fausse 2/7).
- [L'écart de cadrage déclaré est un livrable](feedback_ecarts_cadrage.md) — le dev déclare dans le champ `ecarts` du rapport, la QA rend un verdict **par écart** (US-7 + US-9 : 10 déclarés, 10 acceptés, aucun champ pour les porter).
- [Portes humaines sans lavish](project_portes_humaines_sans_lavish.md) — `lavish-axi` absent du PATH (4 confirmations) : porte ouverte via un `gate` sur le board + texte direct, sans bloquer le flux.
