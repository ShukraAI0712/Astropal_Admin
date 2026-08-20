# AstroPal Admin

Internal admin dashboard for AstroPal. Deployed separately from the main app at `admin.astropal.app`.

Talks to the same Supabase project and the same FastAPI backend (`api.astropal.app`) as the main AskDisha/AstroPal frontend. Access is gated server-side by `caller_role` (`staff` / `admin` / `super_admin`) - see `backend/app/api/routes/support.py` and `backend/app/services/quota_service.py` in the main repo.

## Getting started

```bash
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Environment variables

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project as the main app |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key, safe to ship client-side |
| `NEXT_PUBLIC_API_URL` | FastAPI backend base URL (`https://api.astropal.app` in production) |

Set these in the Vercel project settings for Production/Preview/Development, not just locally.

## Deployment

Deploys to Vercel as its own project, domain `admin.astropal.app`. The backend's `CORS_EXTRA_ORIGINS` (DigitalOcean App Platform env vars) must include this app's origin.
