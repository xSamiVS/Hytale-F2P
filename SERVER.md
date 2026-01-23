# Hytale F2P Server Guide

Play with friends online! This guide covers both easy in-game hosting and advanced dedicated server setup.

DOWNLOAD SERVER FILES HERE: https://discord.gg/MEyWUxt77m

---

## Part 1: Playing with Friends (Online Play)

The easiest way to play with friends - no manual server setup required!

### How It Works

1. **Start the game** via F2P Launcher
2. **Click "Online Play"** in the main menu
3. **Share the invite code** with your friends
4. Friends enter your invite code to join

The game automatically handles networking using UPnP/STUN/NAT traversal.

### Network Requirements

For Online Play to work, you need:

- **UPnP enabled** on your router (most routers have this on by default)
- **Public IP address** from your ISP (not behind CGNAT)

### Common Issues

#### "NAT Type: Carrier-Grade NAT (CGNAT)" Warning

If you see this message:
```
Connected via UPnP
NAT Type: Carrier-Grade NAT (CGNAT)
Warning: Your network configuration may prevent other players from connecting.
```

**What this means:** Your ISP doesn't give you a public IP address. Multiple customers share one public IP, which blocks incoming connections.

**Solutions:**

1. **Contact your ISP** - Request a public/static IP address (may cost extra)
2. **Use a VPN with port forwarding** - Services like Mullvad, PIA, or AirVPN offer this
3. **Use Radmin VPN or Playit.gg** - Create a virtual LAN with friends (see below)
4. **Have a friend with public IP host instead**

#### "UPnP Failed" or "Port Mapping Failed"

**Check your router:**
1. Log into router admin panel (usually `192.168.1.1` or `192.168.0.1`)
2. Find UPnP settings (often under "Advanced" or "NAT")
3. Enable UPnP if disabled
4. Restart your router

**If UPnP isn't available:**
- Manually forward **port 5520 UDP** to your computer's local IP
- See "Port Forwarding" section below

#### "Strict NAT" or "Symmetric NAT"

Some routers have restrictive NAT that blocks peer connections.

**Try:**
1. Enable "NAT Passthrough" or "NAT Filtering: Open" in router settings
2. Put your device in router's DMZ (temporary test only)
3. Use Radmin VPN as workaround

### Workarounds for NAT/CGNAT Issues

#### Option 1: playit.gg (Recommended)

Free tunneling service - only the host needs to install it:

1. **Download [playit.gg](https://playit.gg/)** and run it - Connect your account from the terminal (do not close it when playing on the server)  
2. **Add a tunnel** - Select "UDP", tunnel description of "Hytale Server", port count `1`, and local port `5520`
3. **Start the tunnel** - You'll get a public address like `xx-xx.gl.at.ply.gg:5520`
4. **Share the address** - Friends connect directly using this address

Works with both Online Play and dedicated servers. No software needed for players joining.

#### Option 2: Radmin VPN

Creates a virtual LAN - all players need to install it:

1. **Download [Radmin VPN](https://www.radmin-vpn.com/)** - All players install it
2. **Create a network** - One person creates, others join with network name/password
3. **Host via Online Play** - Use your Radmin VPN IP instead
4. **Friends connect** - They'll see you on the virtual LAN

Both options bypass all NAT/CGNAT issues. But for **Windows machines only!**

#### Option 3: Tailscale
It creates mesh VPN service that streamlines connecting devices and services securely across different networks. And **works crossplatform!!**

1. All member's are required to download [Tailscale](https://tailscale.com/download) on your device.
[Once installed, Tailwind starts and live inside your hidden icon section in Windows, Mac and Linux]
2. Create a **common tailscale** account which will shared among your friends to log in.
3. Ask your **host to login in to thier tailscale client first**, then the other members.
##### Host
  1. Open your singleplayer world
  2. Go to Online Play settings
  3. Re-save your settings to generate a new share code
##### Friends
  1. Ensure Tailscale is connected
2. Use the new share code to connect
[To test your connection, ping the host's ipv4 mentioned in tailwind]
---

## Part 2: Dedicated Server (Advanced)

For 24/7 servers, custom configurations, or hosting on a VPS/dedicated machine.

### Quick Start

#### Step 1: Get the Server JAR

The server scripts will automatically download the pre-patched server JAR if it's not present.

**Option A:** Let the scripts download automatically (requires `HYTALE_SERVER_URL` to be configured)

**Option B:** Manually place `HytaleServer.jar` (pre-patched for F2P) in the Server directory:

- **Windows:** `%localappdata%\HytaleF2P\release\package\game\latest\Server`
- **macOS:** `~/Library/Application Support/HytaleF2P/release/package/game/latest/Server`
- **Linux:** `~/.hytalef2p/release/package/game/latest/Server`

If you have a custom install path, the Server folder is inside your custom location under `HytaleF2P/release/package/game/latest/Server`.

#### Step 2: Run the Server

**Windows:**
```batch
cd scripts
run_server.bat
```

**macOS / Linux:**
```bash
cd scripts
./run_server.sh
```

The scripts will:
1. Find your game installation automatically
2. Download the pre-patched server JAR if needed
3. Fetch session tokens from the auth server
4. Start the server

#### Step 3: Connect Players

Share your server IP address with players. They connect via the F2P Launcher's server browser or direct connect.

---

## Network Setup (Dedicated Server)

### Local Network (LAN)

If all players are on the same network:
1. Find your local IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Share this IP with players on your network
3. Default port is `5520`

### Port Forwarding (Internet Play)

To allow direct internet connections:

1. Forward **port 5520 (UDP)** in your router
2. Find your public IP at [whatismyip.com](https://whatismyip.com)
3. Share your public IP with players

**Windows Firewall:**
```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="Hytale Server" dir=in action=allow protocol=UDP localport=5520
```

---

## Configuration

### Environment Variables

Set these before running to customize your server:

| Variable | Default | Description |
|----------|---------|-------------|
| `HYTALE_SERVER_URL` | (placeholder) | URL to download pre-patched server JAR |
| `HYTALE_AUTH_DOMAIN` | `sanasol.ws` | Auth server domain |
| `HYTALE_BIND` | `0.0.0.0:5520` | Server IP and port |
| `HYTALE_AUTH_MODE` | `authenticated` | Auth mode (see below) |
| `HYTALE_SERVER_NAME` | `My Hytale Server` | Server display name |
| `HYTALE_GAME_PATH` | (auto-detected) | Override game location |
| `JVM_XMS` | `2G` | Minimum Java memory |
| `JVM_XMX` | `4G` | Maximum Java memory |

**Example (Windows):**
```batch
set HYTALE_SERVER_NAME=My Awesome Server
set JVM_XMX=8G
run_server.bat
```

**Example (Linux/macOS):**
```bash
HYTALE_SERVER_NAME="My Awesome Server" JVM_XMX=8G ./run_server.sh
```

### Authentication Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `authenticated` | Players log in via F2P Launcher | Public servers |
| `unauthenticated` | No login required | LAN parties, testing |
| `singleplayer` | Local play only | Solo testing |

---

## RAM Allocation Guide

Adjust memory based on your system:

| System RAM | Players | JVM_XMS | JVM_XMX |
|------------|---------|---------|---------|
| 4 GB | 1-3 | `512M` | `2G` |
| 8 GB | 3-8 | `1G` | `4G` |
| 16 GB | 8-15 | `2G` | `8G` |
| 32 GB | 15+ | `4G` | `12G` |

**Example for large server:**
```bash
JVM_XMS=4G JVM_XMX=12G ./run_server.sh
```

**Tips:**
- `-Xms` = minimum RAM (allocated at startup)
- `-Xmx` = maximum RAM (upper limit)
- Never allocate all your system RAM - leave room for OS
- Start conservative and increase if needed

---

## Server Commands

Once running, use these commands in the console:

| Command | Description |
|---------|-------------|
| `help` | Show all commands |
| `stop` | Stop server gracefully |
| `save` | Force world save |
| `list` | List online players |
| `op <player>` | Give operator status |
| `deop <player>` | Remove operator status |
| `kick <player>` | Kick a player |
| `ban <player>` | Ban a player |
| `unban <player>` | Unban a player |
| `tp <player> <x> <y> <z>` | Teleport player |

---

## Command Line Options

Pass these when starting the server:

```bash
./run_server.sh [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--bind <ip:port>` | Server address (default: 0.0.0.0:5520) |
| `--auth-mode <mode>` | Authentication mode |
| `--universe <path>` | Path to world data |
| `--mods <path>` | Path to mods folder |
| `--backup` | Enable automatic backups |
| `--backup-dir <path>` | Backup directory |
| `--backup-frequency <mins>` | Backup interval |
| `--owner-name <name>` | Server owner username |
| `--allow-op` | Allow op commands |
| `--disable-sentry` | Disable crash reporting |
| `--help` | Show all options |

**Example:**
```bash
./run_server.sh --backup --backup-frequency 30 --allow-op
```

---

## File Structure

```
<game_path>/
├── Assets.zip                 # Game assets (required)
├── Client/                    # Game client
└── Server/
    ├── HytaleServer.jar       # Server executable (pre-patched)
    ├── HytaleServer.aot       # AOT cache (faster startup)
    ├── universe/              # World data
    │   ├── world/             # Default world
    │   └── players/           # Player data
    ├── mods/                  # Server mods (optional)
    └── Licenses/              # License files
```

---

## Backups

### Automatic Backups

```bash
./run_server.sh --backup --backup-dir ./backups --backup-frequency 30
```

### Manual Backup

1. Use `save` command or stop the server
2. Copy the `universe/` folder
3. Store in a safe location

### Restore

1. Stop the server
2. Delete/rename current `universe/`
3. Copy backup to `universe/`
4. Restart server

---

## Troubleshooting

### "Java not found" or "Java version too old"

**Java 21 is REQUIRED** (the server uses class file version 65.0).

**Install Java 21:**
- **Windows:** `winget install EclipseAdoptium.Temurin.21.JDK`
- **macOS:** `brew install openjdk@21`
- **Ubuntu:** `sudo apt install openjdk-21-jdk`
- **Fedora:** `sudo dnf install java-21-openjdk`
- **Arch:** `sudo pacman -S jdk21-openjdk`
- **Download:** [adoptium.net/temurin/releases/?version=21](https://adoptium.net/temurin/releases/?version=21)

**macOS: Set Java 21 as default:**
```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$JAVA_HOME/bin:$PATH"
```
Add these lines to `~/.zshrc` or `~/.bash_profile` to make permanent.

### "Game directory not found"

- Download game via F2P Launcher first
- Or set `HYTALE_GAME_PATH` environment variable
- Check custom install path in launcher settings

### "Assets.zip not found"

Game files incomplete. Re-download via the launcher.

### "Port already in use"

```bash
./run_server.sh --bind 0.0.0.0:5521
```

### "Out of memory"

Increase JVM_XMX:
```bash
JVM_XMX=6G ./run_server.sh
```

### Players can't connect

1. Server shows "Server Ready"?
2. Using F2P Launcher (not official)?
3. Port 5520 open in firewall?
4. Port forwarding configured (for internet)?
5. Try `--auth-mode unauthenticated` for testing

### "Authentication failed"

- Ensure players use F2P Launcher
- Auth server may be temporarily down
- Test with `--auth-mode unauthenticated`

---

## Docker Deployment (Advanced)

For production servers, use Docker:

```bash
docker run -d \
  --name hytale-server \
  -p 5520:5520/udp \
  -v ./data:/data \
  -e HYTALE_AUTH_DOMAIN=sanasol.ws \
  -e HYTALE_SERVER_NAME="My Server" \
  -e JVM_XMX=8G \
  ghcr.io/hybrowse/hytale-server-docker:latest
```

See [Docker documentation](https://github.com/Hybrowse/hytale-server-docker) for details.

---

## Server Settings Summary

### Minimal Setup
```bash
./run_server.sh
```

### Custom Memory
```bash
JVM_XMS=2G JVM_XMX=8G ./run_server.sh
```

### Custom Port
```bash
HYTALE_BIND=0.0.0.0:25565 ./run_server.sh
```

### LAN Party (No Auth)
```bash
./run_server.sh --auth-mode unauthenticated
```

### Full Custom Setup
```bash
HYTALE_SERVER_NAME="Epic Server" \
HYTALE_BIND=0.0.0.0:5520 \
JVM_XMS=2G \
JVM_XMX=8G \
./run_server.sh --backup --backup-frequency 15 --allow-op
```

---

## Getting Help

- Check server console logs for errors
- Test with `--auth-mode unauthenticated` first
- Ensure all players have F2P Launcher
- Join the community for support

---

## Credits

- Hytale F2P Project
- [Hybrowse Docker Image](https://github.com/Hybrowse/hytale-server-docker)
- Auth Server: sanasol.ws
