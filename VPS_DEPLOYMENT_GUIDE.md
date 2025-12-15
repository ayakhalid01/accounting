# VPS Deployment Guide for Accounting App

**VPS Public IP:** `212.24.98.242`  
**Port:** `3001`  
**URL:** `http://212.24.98.242:3001`

---

## Step 1: Update Firewall & Open Port 3001

### On Your VPS (Linux - Ubuntu/Debian)

```bash
# Allow port 3001 through UFW firewall
sudo ufw allow 3001/tcp
sudo ufw status

# Or with iptables (if UFW not available)
sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
sudo iptables -save > /etc/iptables/rules.v4
```

### On Your VPS (Linux - CentOS/RHEL)

```bash
# Allow port 3001 through firewalld
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

### In Cloud Provider (AWS, DigitalOcean, Linode, etc.)

1. Go to **Security Groups** or **Firewall Rules**
2. Add **Inbound Rule**:
   - Protocol: `TCP`
   - Port: `3001`
   - Source: `0.0.0.0/0` (Allow all) or your specific IP
3. Save and apply

---

## Step 2: Connect to Your VPS via SSH

```bash
ssh root@212.24.98.242
# or
ssh username@212.24.98.242
```

---

## Step 3: Install Node.js on VPS

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

---

## Step 4: Clone or Upload Your Project

### Option A: Clone from Git

```bash
cd /home/username
git clone <your-repo-url>
cd accounting-main
```

### Option B: Upload via SFTP

```bash
# On your local machine
sftp username@212.24.98.242
put -r /path/to/accounting-main /home/username/
exit
```

---

## Step 5: Install Dependencies & Build

```bash
cd /home/username/accounting-main

# Install dependencies
npm install

# Build the project
npm run build
```

---

## Step 6: Start the Application

### Option 1: Simple Start (Test)

```bash
npm run start:vps
# Server runs on http://212.24.98.242:3001
```

### Option 2: Production with PM2 (Recommended - Keeps app running)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the application
pm2 start "npm run start:vps" --name "accounting-app"

# Make it start on boot
pm2 startup
pm2 save

# Check status
pm2 status
pm2 logs accounting-app
```

### Option 3: Using Systemd Service (Alternative)

Create `/etc/systemd/system/accounting-app.service`:

```bash
sudo nano /etc/systemd/system/accounting-app.service
```

Add:

```ini
[Unit]
Description=Accounting App
After=network.target

[Service]
Type=simple
User=username
WorkingDirectory=/home/username/accounting-main
ExecStart=/usr/bin/npm run start:vps
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable accounting-app
sudo systemctl start accounting-app
sudo systemctl status accounting-app
```

---

## Step 7: Verify the Application is Running

```bash
# Check if port 3001 is listening
sudo netstat -tlnp | grep 3001
# or
sudo ss -tlnp | grep 3001

# Test locally on VPS
curl http://localhost:3001

# View PM2 logs
pm2 logs accounting-app
```

---

## Step 8: Access from Your Browser

Open: `http://212.24.98.242:3001`

---

## Useful Commands for VPS Management

```bash
# PM2 Commands
pm2 list                          # List all apps
pm2 logs accounting-app           # View logs
pm2 restart accounting-app        # Restart app
pm2 stop accounting-app           # Stop app
pm2 delete accounting-app         # Remove app
pm2 monit                         # Monitor CPU/Memory

# Check port usage
lsof -i :3001                     # What's using port 3001
sudo fuser -k 3001/tcp            # Kill process on port 3001

# View system resources
top                               # CPU/Memory usage
df -h                             # Disk usage
```

---

## Troubleshooting

### Port 3001 not accessible from outside

```bash
# Check if port is listening
sudo netstat -tlnp | grep 3001

# Check firewall rules
sudo ufw status
sudo firewall-cmd --list-all

# Test connectivity from local machine
curl http://212.24.98.242:3001
telnet 212.24.98.242 3001
```

### Application crashes or won't start

```bash
# Check PM2 logs
pm2 logs accounting-app --lines 100

# Check system logs
sudo journalctl -u accounting-app -n 50
```

### High memory usage

```bash
# Increase swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## Environment Variables

### Before Building, Create `.env.local` file

Create it on your **local machine** or **VPS**:

```bash
nano /home/username/accounting-main/.env.local
```

Add your Supabase credentials (get from https://supabase.com/dashboard):

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://212.24.98.242:3001
```

### Save and Exit
- **Nano:** Press `Ctrl+X`, then `Y`, then `Enter`
- **Vi:** Press `Esc`, type `:wq`, press `Enter`

⚠️ **IMPORTANT:** This file contains secrets, do NOT commit to Git!

---

## Quick Deployment Summary

```bash
# SSH into VPS
ssh root@212.24.98.242

# Install Node.js (one-liner)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs

# Navigate to project
cd /home/username/accounting-main

# CREATE .env.local file with Supabase credentials
cat > .env.local << EOF
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://212.24.98.242:3001
EOF

# Install & Build
npm install && npm run build

# Start with PM2
sudo npm install -g pm2
pm2 start "npm run start:vps" --name "accounting-app"
pm2 startup && pm2 save
```

Then visit: `http://212.24.98.242:3001`

---
