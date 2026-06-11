# 11 Cups NHL

## Overview

11 Cups NHL is a browser-based NHL roster drafting game. The core loop asks a simple question: can you build a seven-player roster strong enough to win six Stanley Cups in the modern era benchmark set by Ken Dryden?

The app serves franchise-specific player boards, lets the user draft across positions, applies roster fit and chemistry logic, and reveals a final score and rings result at the end of the run.

## Stack

- Node.js 20+
- Vanilla HTML, CSS, and client-side JavaScript
- Custom HTTP server
- CSV and JSON data pipelines
- Hockey-Reference and NHL asset integrations
- Vercel-compatible deployment flow

## What I Built

- A stateless draft flow with rate-limited API endpoints
- Franchise board generation from historical player datasets
- Position-fit and handedness chemistry scoring
- Wild-card / lifeline mechanics to reshape a draft run
- Mobile-friendly roster and board UI
- Data build scripts for player values, board pools, windows, and headshots
- Automated tests covering the draft engine, stateless API flow, and data shaping logic

## Why I Built It

I wanted a sports product that felt more like a playable systems design project than a static stats page. The interesting part was combining historical hockey data, game mechanics, and lightweight backend logic into something fast enough to run as a simple web app.

## Outcome

The project became a complete draft game with its own data pipeline, scoring model, deploy path, and test coverage. It is a good proof-of-work example for product thinking, backend logic, and turning messy domain data into an interactive experience.

## Run Locally

```bash
npm install
npm run build
npm run dev
```
