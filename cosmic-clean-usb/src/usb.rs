//! USB device detection (unprivileged) and wipe dispatch (via pkexec).

use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct UsbDevice {
    pub path: String,
    pub model: String,
    pub size: String,
    pub usb_version: String,
    pub partitions: Vec<Partition>,
}

#[derive(Debug, Clone)]
pub struct Partition {
    pub path: String,
    pub size: String,
    pub fstype: String,
    pub label: String,
    pub mountpoint: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WipeResult {
    pub device: String,
    pub model: String,
    pub size: String,
    pub usb_version: String,
    pub label: String,
    pub mount_point: String,
    pub write_speed: String,
    pub read_speed: String,
    pub integrity: String,
    pub action: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeMode {
    Quick,
    Secure,
}

/// Discover all USB block devices (no root needed).
pub fn detect_devices() -> Vec<UsbDevice> {
    let output = match Command::new("lsblk")
        .args(["-dnpo", "NAME,TRAN,TYPE,SIZE,MODEL"])
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return Vec::new(),
    };

    let mut devices = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();

        if parts.len() >= 3 && parts[1] == "usb" && parts[2] == "disk" {
            let path = parts[0].to_string();
            let size = parts.get(3).unwrap_or(&"").to_string();
            // Model may contain spaces — join remaining fields
            let model = if parts.len() > 4 {
                parts[4..].join(" ")
            } else {
                "Unknown".to_string()
            };
            let usb_version = get_usb_version(&path);
            let partitions = get_partitions(&path);

            devices.push(UsbDevice {
                path, model, size, usb_version, partitions,
            });
        }
    }
    devices
}

fn get_partitions(device: &str) -> Vec<Partition> {
    let output = match Command::new("lsblk")
        .args(["-npo", "NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT", device])
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return Vec::new(),
    };

    let mut partitions = Vec::new();
    for (i, line) in output.lines().enumerate() {
        if i == 0 { continue; }
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        let fields: Vec<&str> = trimmed.split_whitespace().collect();

        partitions.push(Partition {
            path: fields.first().unwrap_or(&"").to_string(),
            size: fields.get(1).unwrap_or(&"").to_string(),
            fstype: fields.get(2).unwrap_or(&"").to_string(),
            label: fields.get(3).unwrap_or(&"").to_string(),
            mountpoint: fields.get(4).map(|s| s.to_string()),
        });
    }
    partitions
}

fn get_usb_version(device: &str) -> String {
    let name = Path::new(device)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut p = match std::fs::canonicalize(format!("/sys/block/{name}")) {
        Ok(path) => path,
        Err(_) => return "Unknown".into(),
    };

    loop {
        let speed_file = p.join("speed");
        if speed_file.exists() {
            if let Ok(speed_str) = std::fs::read_to_string(&speed_file) {
                return match speed_str.trim() {
                    "12" => "USB 1.1".into(),
                    "480" => "USB 2.0".into(),
                    "5000" => "USB 3.0".into(),
                    "10000" => "USB 3.1".into(),
                    "20000" => "USB 3.2".into(),
                    s => format!("USB ({s} Mbps)"),
                };
            }
        }
        if !p.pop() { break; }
    }
    "Unknown".into()
}

/// Resolve the binary path for pkexec invocation.
/// Always uses the currently running binary so dev builds don't call stale installs.
fn binary_for_pkexec() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| {
            // Fallback to installed path
            "/usr/bin/cosmic-clean-usb".to_string()
        })
}

fn current_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| "root".into())
}

/// Mount via udisksctl (unprivileged for removable devices).
pub fn mount_device(device: &str) -> Result<String, String> {
    let partitions = get_partitions(device);
    if partitions.is_empty() {
        return Err("No partitions — drive is blank. Nothing to browse.".into());
    }
    let part = &partitions[0];

    if let Some(ref mp) = part.mountpoint {
        return Ok(mp.clone());
    }

    // udisksctl doesn't need root for removable devices
    let output = Command::new("udisksctl")
        .args(["mount", "-b", &part.path, "--no-user-interaction"])
        .output()
        .map_err(|e| format!("udisksctl mount failed: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Output like: "Mounted /dev/sda1 at /media/user/LABEL"
        stdout.split(" at ").nth(1)
            .map(|s| s.trim().trim_end_matches('.').to_string())
            .ok_or_else(|| "Could not parse mount point".into())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Mount failed: {stderr}"))
    }
}

/// Open a path in the default file browser.
pub fn open_in_browser(path: &str) {
    let _ = Command::new("gio").args(["open", path]).spawn();
}

/// Wipe a device by calling ourselves via pkexec. Blocking — call from async task.
pub fn wipe_device(device: &str, mode: WipeMode) -> Result<WipeResult, String> {
    let bin = binary_for_pkexec();
    let mode_arg = match mode {
        WipeMode::Quick => "quick",
        WipeMode::Secure => "secure",
    };
    let user = current_user();

    eprintln!("[cleanusb] pkexec {bin} --backend wipe {mode_arg} {device} {user}");

    let output = Command::new("pkexec")
        .args([&bin, "--backend", "wipe", mode_arg, device, &user])
        .output()
        .map_err(|e| format!("Failed to launch pkexec: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    eprintln!("[cleanusb] exit={}, stdout={}, stderr={}", output.status, stdout.trim(), stderr.trim());

    if !output.status.success() {
        if stderr.contains("dismissed") || stderr.contains("Not authorized") {
            return Err("Authentication cancelled".into());
        }
        return Err(format!("Wipe failed: {stderr}"));
    }

    let json_line = stdout.lines().last()
        .ok_or("No output from backend")?;

    serde_json::from_str::<WipeResult>(json_line)
        .map_err(|e| format!("Failed to parse result: {e}\nOutput: {stdout}"))
}
