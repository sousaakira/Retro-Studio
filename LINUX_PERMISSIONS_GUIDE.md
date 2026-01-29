# 🔧 Linux Permissions Guide - Mark 1 Cartridge Programmer

## 🐧 **Problem: Permission Denied on Linux**

When connecting the Mark 1 cartridge programmer on Linux, you may encounter permission errors:

```
Failed to open serial port
Access denied
No port selected by the user
```

---

## ⚡ **Quick Fix (Temporary)**

### **1. Identify Your Device**
```bash
# List available serial devices
ls -la /dev/ttyACM*
# or
ls -la /dev/ttyUSB*
```

### **2. Grant Permissions**
```bash
# For ACM devices (common for USB-CDC)
sudo chmod 777 /dev/ttyACM0

# For USB devices
sudo chmod 777 /dev/ttyUSB0
```

### **3. Test Connection**
1. Open Retro Studio
2. Press `Ctrl+P` to open Cartridge Programmer
3. Click "Connect to Mark 1"
4. Select your device when prompted

---

## 🔄 **Permanent Fix (Recommended)**

### **Add User to dialout Group**
```bash
# Add current user to dialout group
sudo usermod -a -G dialout $USER

# Log out and log back in, or reboot
# Then test without sudo chmod
```

### **Create udev Rule (Best Solution)**
```bash
# Create udev rule for Mark 1 device
sudo nano /etc/udev/rules.d/99-mark1.rules
```

Add this content (replace with your actual vendor/product IDs):
```udev
# Mark 1 Cartridge Programmer
SUBSYSTEM=="tty", ATTRS{idVendor}=="2e8a", ATTRS{idProduct}=="xxxx", MODE="0666", GROUP="dialout"
```

Reload udev rules:
```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

---

## 🔍 **Troubleshooting**

### **Check Device Connection**
```bash
# List all USB devices
lsusb

# Look for your Mark 1 device (Vendor ID: 2e8a)
Bus 001 Device 005: ID 2e8a:xxxx Mark 1 Programmer
```

### **Check Serial Ports**
```bash
# List available serial ports
dmesg | grep tty
# or
ls /dev/tty*
```

### **Verify Permissions**
```bash
# Check current permissions
ls -la /dev/ttyACM0
# Should show: crw-rw-rw- 1 root dialout ...

# Check if user is in dialout group
groups $USER
# Should include: dialout
```

---

## 🎯 **Retro Studio Integration**

The Cartridge Programmer component now includes:

✅ **Auto-detection** of Linux permission errors  
✅ **Helper UI** with copy-to-clipboard commands  
✅ **Step-by-step instructions** built into the interface  
✅ **Error messages** with specific Linux solutions  

When a permission error occurs, you'll see a blue helper box with:

1. **Command to copy**: `sudo chmod 777 /dev/ttyACM0`
2. **Copy button** for easy clipboard access
3. **Permanent fix** instructions
4. **Troubleshooting tips**

---

## 🚀 **After Fixing Permissions**

1. **Connect** your Mark 1 device via USB
2. **Open** Retro Studio (`Ctrl+P`)
3. **Click** "Connect to Mark 1"
4. **Select** your device from the browser prompt
5. **Start programming** your ROMs!

---

## 📝 **Common Device Paths**

| Device Type | Typical Path | Command |
|-------------|--------------|---------|
| USB-CDC (ACM) | `/dev/ttyACM0` | `sudo chmod 777 /dev/ttyACM0` |
| USB Serial | `/dev/ttyUSB0` | `sudo chmod 777 /dev/ttyUSB0` |
| Multiple devices | `/dev/ttyACM1`, `/dev/ttyUSB1` | Adjust number accordingly |

---

## ⚠️ **Security Note**

- `chmod 777` gives full permissions to all users (temporary fix)
- `dialout` group membership is more secure (permanent fix)
- udev rules are the most secure and automated solution

Choose the method that best fits your security requirements!
