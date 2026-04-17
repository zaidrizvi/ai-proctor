---
title: AIProctor ML Service
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
suggested_hardware: cpu-basic
startup_duration_timeout: 1h
short_description: AIProctor ML API for face, head, object, and audio checks.
---

# AIProctor ML Service

This repository is prepared for deployment as a Hugging Face Docker Space.

## What it serves

- `GET /`
- `GET /health`
- `POST /face/detect`
- `POST /face/reference-embedding`
- `POST /face/verify`
- `POST /head/analyze`
- `POST /gaze/analyze`
- `POST /objects/detect`
- `POST /audio/analyze`

## Deploy to Hugging Face Spaces

1. Create a new Space on Hugging Face.
2. Choose `Docker` as the SDK.
3. Push the contents of this `ml-service` folder to the Space repository root.
4. In the Space settings, add these variables if needed:
   - `CLIENT_URL=https://aiproctor-frontend.onrender.com`
   - `ALLOWED_ORIGINS=https://aiproctor-frontend.onrender.com`
   - `YOLO_OBJECT_MODEL=yolo26s.pt`
5. Wait for the Docker build to finish.
6. Open `/health` on the Space URL and confirm:
   - `routersRegistered: true`
   - `routerRegistrationError: null`

## Important notes

- This service is heavy for free CPU hosting because it uses DeepFace, TensorFlow, MediaPipe, PyTorch, and YOLO.
- First startup can take a while while models import and initialize.
- If the free CPU Space is unstable, keep frontend/backend deployed and continue using local ML through ngrok for demos.
- L2CS-Net gaze tracking expects a pretrained checkpoint at `models/l2cs/L2CSNet_gaze360.pkl` by default.
- You can override the checkpoint path with `L2CS_WEIGHTS_PATH` and the backbone with `L2CS_ARCH` (`ResNet18`, `ResNet34`, `ResNet50`, `ResNet101`, or `ResNet152`).

## Local run

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Object detection defaults to `yolo26s.pt`. The service looks for a local weights file in the `ml-service` directory first, and otherwise falls back to the Ultralytics model name from `YOLO_OBJECT_MODEL`.
