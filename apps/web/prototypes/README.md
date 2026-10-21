# Constraint Lens prototype

`constraint-lens.html` contains the WorldSize and WorldSize V2 visualizations. Rebuild its embedded config-core bundle after changing the prototype source:

```powershell
node apps/web/prototypes/build-constraint-lens.mjs
```

WorldSize V2 requests repair candidates from the V2 service at `/mindspeed-config/prototypes/constraint-lens.html`. The page calls the same-origin authenticated `/mindspeed-config/api/tools/suggest_config_fixes` endpoint and renders `structuredContent.data.suggestions`. Opening the HTML directly from disk does not provide service-backed repair suggestions.

The local balance logic and its Golden cases can be checked with:

```powershell
node --test apps/web/prototypes/constraint-lens-balance.verify.mjs
```