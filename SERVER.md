# Hytale F2P Server Setup Guide

## Server File Setup

**Download server file:**
```
https://files.hytalef2p.com/server
```

**Replace the file here:**  
`<your_path>\HytaleF2P\release\package\game\latest\Server`

If you don't have any custom installation path:

1. Press **WIN + R**  
2. Type: `%localappdata%\HytaleF2P\release\package\game\latest\Server`  
3. Press **Enter**

You will be redirected to the correct folder automatically.

## Network Setup - Radmin VPN Required

**Important:** The server only supports third-party software for LAN-style connections. You must use **Radmin VPN** to connect players together.

1. **Download and install [Radmin VPN](https://www.radmin-vpn.com/)**
2. **Create or join a network** in Radmin VPN
3. **All players must be connected** to the same Radmin network
4. **Use the Radmin VPN IP address** to connect to the server

This creates a virtual LAN environment that allows the Hytale server to work properly with multiple players.

## RAM Allocation Guide (Windows)

When you start a Hytale server using `start-server.bat`, Java will use very little memory by default.  
This can cause slow startup, crashes, or the server not launching at all.

**You should always allocate RAM in your launch command.**

Edit your `start-server.bat` file and use the version that matches your PC:

---

### PC with 4 GB RAM
*Best for small servers / testing*

```bash
java -Xms512M -Xmx2G -jar HytaleServer.jar --assets ..\Assets.zip
```

- Uses up to **2 GB**
- Leaves enough memory for Windows

---

### PC with 8 GB RAM
*Good for small communities*

```bash
java -Xms1G -Xmx4G -jar HytaleServer.jar --assets ..\Assets.zip
```

- Uses up to **4 GB**
- Stable for most setups

---

### PC with 16 GB RAM
*Perfect for large or modded servers*

```bash
java -Xms2G -Xmx8G -jar HytaleServer.jar --assets ..\Assets.zip
```

- Uses up to **8 GB**
- Ideal for heavy worlds and plugins

---

## Tips

- `-Xms` = minimum RAM allocation
- `-Xmx` = maximum RAM allocation  
- **Never allocate all your system RAM** — Windows still needs memory to run
- **Test your configuration** with a small world first
- **Monitor server performance** and adjust RAM as needed


