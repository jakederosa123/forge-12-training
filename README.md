# Forge 12 Training System

Forge 12 is a free, local-first training website built from the included 12-week autoregulated hypertrophy program. It opens with Pull A, runs six days per week, and includes strength, hypertrophy, power, athletic conditioning, mobility, programmed deloads, supersets, drop sets, rest-pause work, and exercise substitutions.

No account, paid host, or database is required. Workout data auto-saves in the browser you use. Download a JSON backup from Settings before clearing browser data or moving to another device.

## Fastest way to run it

You need Node.js 22 or newer.

```bash
cd hypertrophy-training-system
npm install
npm run static
```

Open `http://localhost:8080` in your browser. Keep that terminal window open while you use the site. Press `Control+C` in the terminal to stop it.

## Full development site

This path runs the Next.js wrapper used for the included build pipeline.

```bash
cd hypertrophy-training-system
npm install
npm run dev
```

Open the local address printed in the terminal.

## Validate the entire project

```bash
npm run check
```

That command verifies the 12-week training data, checks the website files, runs the tests and linter, creates the production build, and validates the resulting artifact.

## Create a clean upload package

```bash
npm run package:release
```

The command creates `release/hypertrophy-training-system.zip`. The plain website that can be copied to an existing web host is in `public/training-app/`.

## What is included

- 12 weeks and 72 sessions, with 660 programmed exercise entries
- Pull A as Week 1, Day 1
- Daily readiness scoring with programmed set and load reductions
- Set-by-set load and rep logging
- RIR, pain, metrics, notes, and session completion tracking
- Automatic next-load recommendations
- Adherence, tonnage, muscle-volume, and estimated 1RM views
- Full session and exercise editor
- JSON backup and restore
- CSV workout-log export
- Offline caching after the first successful load
- The original spreadsheet in `reference/`

## Important storage note

Local browser storage is free, but it belongs to that browser and device. Private browsing, browser cleanup, or a device change can remove access to the saved data. Use Settings, then Download backup, to create a portable copy.

## Training safety

This project is for experienced, healthy adults and is not medical care or injury rehabilitation. Stop for sharp, radiating, or escalating pain. Use the included readiness and pain rules, and get qualified medical guidance when needed.

