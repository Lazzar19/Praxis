---
name: stop-praxis
description: Turn Praxis off and keep the decision notes
---

Turn Praxis off for this project. Use this only when Praxis is already on. Write `.praxis/progress.md` with exactly these lines:

```text
Praxis: off
Status: off
Bypass: none
```

Do not delete `.praxis`. Do not delete `decisions.md`, the map, the marks, the review, or the timeline. Do not ask another question. A later `/start-praxis` still has those notes.
