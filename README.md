# NullRadt

**Offline-first health monitoring for astronauts on long-duration space missions.**

On a deep-space mission, a medical crisis can't wait for Earth. Communication delays and blackouts make real-time support impossible. NullRadt gives the crew medical autonomy with a mobile app that checks physical and psychological health **on the device**, works **without a signal**, and syncs with an Earth-based panel for flight surgeons and mission control once the link is back.

> Team **AndroMajes** · NASA Space Apps Challenge 2026 · Challenge: *Create Health Monitoring Software for Astronauts on Space Missions*
>
> ⚠️ Prototype. **Decision support, not diagnosis.** All crew data is **synthetic**. NASA does not sponsor or endorse this project.

---

## 🔎 Verify the deployment

The API is live on Render (free plan, synthetic data):

| What | Link |
|---|---|
| **API base URL** | https://astro-health-api-81jd.onrender.com/api/v1 |
| **Health check** | https://astro-health-api-81jd.onrender.com/api/v1/health |
| **Interactive API docs (Swagger / OpenAPI)** | https://astro-health-api-81jd.onrender.com/api/docs |
| **Android APK** | [Releases](https://github.com/DTCarlox77/NasaSpaceApps/releases) |

A healthy deployment answers:

```json
{ "status": "ok", "db": "up", "time": "…", "version": "0.1.0" }
```

> The free Render plan sleeps when it isn't used. **The first request can take ~50 s** while the server wakes up. Just retry.

Quick check from a terminal:

```bash
# health
curl https://astro-health-api-81jd.onrender.com/api/v1/health

# sign in as a demo astronaut (synthetic account)
curl -X POST https://astro-health-api-81jd.onrender.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"a.ortega","password":"Demo2026!","device_id":"readme-check"}'
```

### Demo accounts (synthetic)

Password for all of them: **`Demo2026!`**

| User | Role | Use it in |
|---|---|---|
| `a.ortega` | ORION, commander | Mobile app |
| `k.mensah` | VEGA, crew medical officer | Mobile app |
| `dr.reyes` | Flight surgeon | Web panel |
| `bh.salas` | Behavioral health | Web panel |
| `mission.control` | Mission control (admin) | Web panel |

Please don't use `m.silva`: that account is forced to change the shared password on first login. The database is shared, so if you open a test emergency, close it as *cancelled*.

---

## ✨ What it does

### 📱 Astronaut app (`nullradt/`)
- **3D body map**: 7 body systems colored by status (normal / caution / critical / not evaluated), on a real 3D mesh.
- **Vital signs**: heart rate, SpO₂, blood pressure, temperature, respiratory rate, grip strength and more, from simulated Bluetooth devices or manual entry with a photo.
- **On-device evaluation with cited rules only** (NEWS2, AHA, EWGSOP2, NHANES sex-specific ranges). An indicator without a validated rule shows *not evaluated*, never "fine".
- **Psychological wellbeing**: confidential daily check-in (mood, fatigue, stress, crew friction, sleep, private note), PHQ-2/GAD-2 screening and an "I want to talk to someone" request. The crew never sees another member's wellbeing.
- **Cognitive tests**: PVT reaction time, Stroop, memory and vision.
- **Emergencies**: **shake the phone** or press SOS (available even when the app is locked) to start an emergency protocol with **voice-guided triage** for the crew and Earth.
- **Offline-first, delay-tolerant sync**: everything works without a link. Data is queued and sent when the signal returns. The Earth link delay is modeled (Moon / Mars / demo profiles with scheduled blackouts).
- **Hands-free voice assistant** (wake word "NullRadt"), spoken reports and dictation.
- Routine reminders, achievements, biometric/PIN unlock, auto-lock, role-based access, **English/Spanish** and light/dark themes.

### 🖥️ Earth panel (`panel/`)
Web app for **mission control**, **flight surgeons** and **behavioral health**: crew dashboard with vital trends, alerts and emergencies by priority, compliance and messaging with the crew. Each role only sees what it should.

### ⚙️ API (`backend/`)
REST API that receives readings, runs the shared status engine and triage, manages emergencies and the delayed Earth link, and enforces role-based confidentiality. It includes a simulator for the demo (14 days of synthetic history and live scenarios such as a CO₂ spike or a solar event).

---

## 🏗️ Architecture

```
 ┌──────────────────────────┐        delayed link         ┌──────────────────────────┐
 │  Astronaut app (Expo)    │   (queued, synced later)    │  Earth panel (React)     │
 │  · local store + rules   │ ─────────┐       ┌───────── │  flight surgeon · BH ·   │
 │  · works with no signal  │          ▼       ▼          │  mission control         │
 └──────────────────────────┘     ┌───────────────────┐   └──────────────────────────┘
                                  │  API (Express)    │
                                  │  status engine ·  │
                                  │  triage · roles   │
                                  └─────────┬─────────┘
                                            │
                                     ┌──────▼──────┐
                                     │ PostgreSQL  │   (Render)
                                     └─────────────┘
```

## 🧰 Tech stack

| Part | Technologies |
|---|---|
| Mobile app | TypeScript, React Native 0.88, Expo SDK 58 (expo-router), Clean Architecture (domain / data / presentation), Zustand, i18next, Three.js, react-native-svg, Reanimated, expo-sqlite, secure-store, local-authentication, sensors, speech, notifications, background-task |
| API | Node.js, Express 5, PostgreSQL 16, JWT + bcrypt, Helmet, OpenAPI + Swagger UI, `node --test` |
| Web panel | React 19, Vite, TypeScript, React Router, TanStack Query, Recharts, Vitest |
| Deploy | Render (API + database, `render.yaml` blueprint) |

## 📁 Repository structure

```
.
├── nullradt/   # astronaut mobile app (Expo / React Native)
├── backend/    # REST API + PostgreSQL (docs, contract and runbook in backend/docs)
├── panel/      # Earth web panel (React + Vite)
└── render.yaml # Render blueprint for the API and the database
```

---

## 🚀 Run it locally

### Mobile app
```bash
cd nullradt
cp .env.example .env      # points to the Render API by default
npm install
npx expo start --go       # scan the QR code with Expo Go
```
Voice recognition needs a development build. To build a release APK on Android:
```bash
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
```

### API
```bash
cd backend
npm ci
npm run db:up             # PostgreSQL in Docker
npm run db:reset          # migrations + synthetic seed
npm run dev               # http://localhost:3000/api/v1
```
Full guide (environment variables, simulator, smoke test, demo-day runbook): [`backend/README.md`](backend/README.md).

### Web panel
```bash
cd panel
cp .env.example .env      # VITE_API_URL = Render API by default
npm ci
npm run dev               # http://localhost:5173
```
It also has a no-server demo mode (`VITE_DATA_MODE=mock`). See [`panel/README.md`](panel/README.md).

---

## 🛰️ NASA resources

- [NASA Human Research Program – 5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/)
- [NASA Human Research Program – Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/)
- [NASA Human Research Program](https://www.nasa.gov/hrp/)
- [NASA NTRS – Space Radiation Protection Strategies (ARS from SPE)](https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf)

## 📚 Clinical references and third-party resources

- [NEWS2 – Royal College of Physicians](https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/) · [NWAS NHS](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score)
- [AHA – Understanding Blood Pressure Readings](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings)
- [CDC/NCHS NHSR 41 – Resting pulse reference data (NHANES)](https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf)
- [EWGSOP2 – Sarcopenia consensus (Age and Ageing 2019)](https://doi.org/10.1093/ageing/afy169) · [Dodds et al. 2014 – Grip strength (PLoS ONE)](https://doi.org/10.1371/journal.pone.0113637)
- [StatPearls – Hypercalciuria](https://www.ncbi.nlm.nih.gov/books/NBK448183/) · [AAO – Eye pressure](https://www.aao.org/eye-health/anatomy/eye-pressure)
- START triage: [CHEMM (HHS)](https://chemm.hhs.gov/startalgotext.htm) · [WikEM](https://www.wikem.org/wiki/Start_triage) · [ORAU/REACTS – ARS Triage Handout](https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf)
- [MakeHuman base mesh (CC0)](https://github.com/makehumancommunity/makehuman) for the 3D body
- Fonts: [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) and [Lexend](https://www.lexend.com) (SIL Open Font License)

## 🤖 AI disclosure

AI tools assisted with code, debugging, documentation and translation (Claude, Anthropic). All of it was reviewed by the team. The demo video's animations were coded with AI assistance and its voiceover was generated with a neural text-to-speech model (Piper, `en_US-lessac-high`). The music and sound effects were synthesized by code. No NASA logos or branding were generated or used.

## 👩‍🚀 Team AndroMajes

Víctor Mateo Alcocer López · Mauro Engelbert Delgado Saenz · Carlos Adrián Espinosa Luna · Claudia Sofía Vargas Ayerdis · María Alejandra Sarante Salinas · Jorge Adán Ortega Torres

---

© 2026 AndroMajes. Built for the NASA Space Apps Challenge 2026.
