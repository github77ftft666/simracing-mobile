# BACKEND_CONTEXT

## PitLink receiver

- Локальный ПК‑ресивер расположен в `receiver/` и поднимает WebSocket на TCP 32100.
- Он принимает нормализованные `state` и `event` сообщения. Эмулятор XInput/ViGEm — следующий Windows‑слой, отделённый от транспорта.

## Журнал

- 2026-08-31: создан локальный WebSocket‑ресивер MVP.
