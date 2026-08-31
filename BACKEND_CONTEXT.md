# BACKEND_CONTEXT

## PitLink receiver

- Локальный ПК‑ресивер расположен в `receiver/` и поднимает WebSocket на TCP 32100.
- Он принимает нормализованные `state` и `event` сообщения. Эмулятор XInput/ViGEm — следующий Windows‑слой, отделённый от транспорта.
- `controller-desktop/` — Windows‑ресивер, упаковываемый в `PitLink-Controller.exe`. Он создаёт одноразовую пару по QR, поднимает WSS 32100, QR‑страницу 32102 и страницу установки локального CA 32103. Корневой CA и ключи хранятся в `%LOCALAPPDATA%\PitLinkController`; при смене LAN‑IP перевыпускается серверный сертификат с IP в SAN. Профиль Automobilista 2 переводит команды в клавиатурные A/D/W/S, Space и Left Alt.

## Журнал

- 2026-08-31: создан локальный WebSocket‑ресивер MVP.
- 2026-08-31: добавлен Windows Controller с QR‑сопряжением и профилем Automobilista 2.
- 2026-08-31: Windows Controller переведён на локальный WSS с самостоятельной установкой CA для iOS и Android.
- 2026-08-31: упакованный Controller запрашивает UAC‑разрешение на правило Windows Firewall для Private network и своих TCP‑портов.
