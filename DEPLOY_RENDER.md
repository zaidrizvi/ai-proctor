# Deploy On Render

This repo is prepared for a free demo deployment on Render using:

- `aiproctor-frontend` as a Static Site
- `aiproctor-backend` as a Web Service
- `aiproctor-ml-service` as a Web Service
- MongoDB Atlas as the database

## Before you start

1. Push this repo to GitHub.
2. Create a free MongoDB Atlas cluster and copy its connection string.
3. Generate a new JWT secret.
4. Keep your Gemini API key ready if you want MCQ generation enabled.

## Deploy the Blueprint

1. In Render, choose `New +` -> `Blueprint`.
2. Connect this GitHub repo.
3. Render will detect `render.yaml` and propose creating the three services.
4. For the first deploy, leave the frontend env vars blank until the backend and ML services have public URLs.

## Fill in environment variables

After Render creates the services, open each service and set:

### `aiproctor-backend`

- `CLIENT_URL=https://<your-frontend>.onrender.com`
- `MONGO_URI=<your Atlas URI>`
- `JWT_SECRET=<your new secret>`
- `GEMINI_API_KEY=<your Gemini key>`

### `aiproctor-ml-service`

- `CLIENT_URL=https://<your-frontend>.onrender.com`
- `ALLOWED_ORIGINS=https://<your-frontend>.onrender.com`

### `aiproctor-frontend`

- `VITE_API_URL=https://<your-backend>.onrender.com`
- `VITE_SOCKET_URL=https://<your-backend>.onrender.com`
- `VITE_ML_URL=https://<your-ml-service>.onrender.com`

Save the env vars and redeploy the services.

## Smoke test

Check these URLs after deploy:

- Frontend: `https://<your-frontend>.onrender.com`
- Backend health: `https://<your-backend>.onrender.com/`
- ML health: `https://<your-ml-service>.onrender.com/health`

## Free-tier notes

- Render free web services sleep after inactivity, so the first request can be slow.
- The backend and ML service each use free instance hours from the same Render workspace.
- This setup is good for demos and project reviews, not for production uptime.

## Security note

The local `backend/.env` in this repo contains real-looking secrets. Rotate them before any public deployment and only store production secrets in Render's environment variable settings.
