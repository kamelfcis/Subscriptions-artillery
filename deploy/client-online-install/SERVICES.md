# Legacy WinSW Windows services (optional)

**Preferred process manager is PM2** — see **[PM2.md](PM2.md)**.

WinSW services **SubscriptionsAPI** / **SubscriptionsWeb** remain available if you pass `-UseWindowsServices` to the installer or run `Install-WindowsServices.bat`.

```bat
sc start SubscriptionsAPI
sc start SubscriptionsWeb
sc stop SubscriptionsAPI
sc stop SubscriptionsWeb
```

Uninstall WinSW: `scripts\Uninstall-WindowsServices.ps1`.
