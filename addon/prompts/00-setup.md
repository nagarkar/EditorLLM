# Folder structure for addons. 

We expect the 'addon' folder to exist somewhere in teh directory; the contents .

```
addon/
├── gcp-for-addon.sh            Phase 1 — GCP setup
├── fix-appscript-json.sh       Phase 2 — manifest transformation
├── deploy_privacy.sh           Phase 7 — GitHub Pages publisher
├── launch-checks.sh            Phase 8 — pre-launch readiness gate
├── listing/
│   └── listing.json            Shared metadata: name, URLs, descriptions
└── prompts/
    ├── 00-setup.md LLM prompt — this file
    ├── 01-portability-audit.md LLM prompt — find portability smells
    ├── 02-code-migration.md    LLM prompt — apply code changes
    └── 03-generate-listing-assets.md  LLM prompt — generate all Marketplace artifacts

```

# How it all connects

The recommended run order for a first-time add-on migration is as follows. "llm" can be claude, gemini or a higher end model.

## Step 1: find problems
llm < addon/prompts/01-portability-audit.md

## Step 2: fix them
llm < addon/prompts/02-code-migration.md

## Step 3: GCP setup (interactive first run, non-interactive after)
bash addon/gcp-for-addon.sh

## Step 4: generate all listing assets (fill in CONTEXT section first)
llm < addon/prompts/03-generate-listing-assets.md

## Step 5: publish privacy + ToS to GitHub Pages
bash addon/deploy_privacy.sh

## Step 6: gate before any deploy
bash addon/launch-checks.sh

## Step 7: deploy the add-on
npm run deploy:addon

# Key design decisions:

* listing/listing.json is the single source of truth for metadata. fix-appscript-json.sh reads name from it; deploy_privacy.sh writes privacyUrl and tosUrl back into it; launch-checks.sh reads the URLs from it to do live HTTP checks.
* deploy:addon swaps appsscript-addon.json into dist/appsscript.json after the build but before clasp push — the regular build pipeline and container-bound deployments are completely unaffected.
* gcp-for-addon.sh --yes (used in addon:prechecks) skips the interactive "use this project?" confirmation once projectId is already set, making deploy:addon fully non-interactive after the first run.
* All four shell scripts are reusable in any GAS project following this trajectory — the only EditorLLM-specific content is in listing/listing.json and the prompts' CONTEXT sections.