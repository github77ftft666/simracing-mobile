# BACKEND_CONTEXT

## PitLink receiver

- Локальный ПК‑ресивер расположен в `receiver/` и поднимает WebSocket на TCP 32100.
- Он принимает нормализованные `state` и `event` сообщения. Эмулятор XInput/ViGEm — следующий Windows‑слой, отделённый от транспорта.
- `controller-desktop/` — Windows‑ресивер, упаковываемый в `PitLink-Controller.exe`. Он создаёт одноразовую пару по QR, поднимает WS 32100 и локальную QR‑страницу 32102; профиль Automobilista 2 переводит команды в клавиатурные A/D/W/S, Space и Left Alt.

## Журнал

- 2026-08-31: создан локальный WebSocket‑ресивер MVP.
- 2026-08-31: добавлен Windows Controller с QR‑сопряжением и профилем Automobilista 2.
