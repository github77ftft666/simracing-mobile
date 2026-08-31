# FRONTEND_CONTEXT

## PitLink PWA

- Клиент находится в `src/`, собран на React + Vite, рассчитан на горизонтальную ориентацию телефона.
- Управление использует `DeviceOrientationEvent`: `gamma` — руль, `beta` — газ/тормоз; текущая ориентация сохраняется кнопкой «Центр».
- Связь с ПК только локальная через WebSocket endpoint, сохранённый в `localStorage`.
- PWA manifest и service worker находятся в `public/`.

## Журнал

- 2026-08-31: создан MVP PitLink PWA.
