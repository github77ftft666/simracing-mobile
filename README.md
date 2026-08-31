# PitLink

PWA‑контроллер для PC‑гоночных игр и локальный Windows‑ресивер.

Полное ТЗ, протокол и порты: [TECH_SPEC.md](./TECH_SPEC.md).

```powershell
npm install
npm run dev
cd receiver; npm install; npm start
```

## Windows Controller

```powershell
cd controller-desktop
npm install
npm run build:exe
```

Готовый файл: `controller-desktop/dist/PitLink-Controller.exe`. После запуска откроется QR‑страница: в PWA выберите ⚙ → «Сканировать QR». Контроллер использует локальный WSS: после первого сканирования откройте в PWA настройку сертификата, установите локальный CA‑сертификат для своего телефона и затем нажмите «Сохранить и подключить».
