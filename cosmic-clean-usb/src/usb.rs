//! USB device detection and operations via system commands.
//! The GUI runs unprivileged; privileged operations use pkexec for elevation.
//! Requires: lsblk, wipefs, parted, mkfs.exfat, dd, pkexec

use std::path::{Path, PathBuf};
use std::process::Command;

/// Run a command elevated via pkexec.
fn pkexec(cmd: &str, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("pkexec")
        .arg(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("pkexec {cmd} failed: {e}"))
}

/// Run a command elevated via pkexec, returning only success/failure.
fn pkexec_status(cmd: &str, args: &[&str]) -> Result<(), String> {
    let output = pkexec(cmd, args)?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("{cmd} failed: {stderr}"))
    }
}

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

#[derive(Debug, Clone, serde::Deserialize)]
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

/// Discover all USB block devices.
pub fn detect_devices() -> Vec<UsbDevice> {
    let output = Command::new("lsblk")
        .args(["-dnpo", "NAME,TRAN,TYPE,SIZE,MODEL"])
        .output();

    let output = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return Vec::new(),
    };

    let mut devices = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(5, char::is_whitespace)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        if parts.len() >= 3 && parts[1] == "usb" && parts[2] == "disk" {
            let path = parts[0].to_string();
            let size = parts.get(3).unwrap_or(&"").to_string();
            let model = parts.get(4).unwrap_or(&"Unknown").to_string();
            let usb_version = get_usb_version(&path);
            let partitions = get_partitions(&path);

            devices.push(UsbDevice {
                path,
                model,
                size,
                usb_version,
                partitions,
            });
        }
    }
    devices
}

fn get_partitions(device: &str) -> Vec<Partition> {
    let output = Command::new("lsblk")
        .args(["-npo", "NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT", device])
        .output();

    let output = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return Vec::new(),
    };

    let mut partitions = Vec::new();
    for (i, line) in output.lines().enumerate() {
        if i == 0 { continue; } // skip the disk line
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        // Parse fixed-width lsblk output
        let fields: Vec<&str> = trimmed.splitn(5, char::is_whitespace)
            .map(|s| s.trim())
            .collect();

        partitions.push(Partition {
            path: fields.first().unwrap_or(&"").to_string(),
            size: fields.get(1).unwrap_or(&"").to_string(),
            fstype: fields.get(2).unwrap_or(&"").to_string(),
            label: fields.get(3).unwrap_or(&"").to_string(),
            mountpoint: fields.get(4).map(|s| s.to_string()).filter(|s| !s.is_empty()),
        });
    }
    partitions
}

fn get_usb_version(device: &str) -> String {
    let name = Path::new(device)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let syspath = std::fs::read_link(format!("/sys/block/{name}"))
        .or_else(|_| std::fs::canonicalize(format!("/sys/block/{name}")))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Walk up to find USB speed attribute
    let mut p = PathBuf::from(&syspath);
    if p.is_relative() {
        p = PathBuf::from("/sys/block").join(&name);
        if let Ok(canonical) = std::fs::canonicalize(&p) {
            p = canonical;
        }
    }

    loop {
        let speed_file = p.join("speed");
        if speed_file.exists() {
            if let Ok(speed_str) = std::fs::read_to_string(&speed_file) {
                let speed = speed_str.trim();
                return match speed {
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

fn current_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| "root".into())
}

/// Find the clean-usb-backend script relative to the running binary.
fn backend_path() -> PathBuf {
    // The binary is at cosmic-clean-usb/target/{debug,release}/cosmic-clean-usb
    // The backend script is at clean-usb-backend (sibling of cosmic-clean-usb dir)
    if let Ok(exe) = std::env::current_exe() {
        // Walk up from target/release/ to the toolkit root
        if let Some(toolkit_dir) = exe.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let candidate = toolkit_dir.join("clean-usb-backend");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // Fallback: assume it's in PATH or current dir
    PathBuf::from("/home")
        .join(current_user())
        .join("Code/Bang-Labs/toolkit/clean-usb-backend")
}

/// Mount a device's first partition, return mount point.
pub fn mount_device(device: &str) -> Result<String, String> {
    let user = current_user();
    let mount_base = format!("/media/{user}");

    let partitions = get_partitions(device);
    let part = partitions.first().ok_or("No partitions found")?;

    // Already mounted?
    if let Some(ref mp) = part.mountpoint {
        return Ok(mp.clone());
    }

    let label = if part.label.is_empty() { "USB" } else { &part.label };
    let mount_point = format!("{mount_base}/{label}");

    pkexec("mkdir", &["-p", &mount_point])?;
    pkexec_status("mount", &[&part.path, &mount_point])?;

    Ok(mount_point)
}

/// Open a path in the default file browser.
pub fn open_in_browser(path: &str) {
    let _ = Command::new("xdg-open").arg(path).spawn();
}

/// Run the wipe operation via the backend script elevated with pkexec.
/// This is blocking and should be called from a tokio task.
pub fn wipe_device(device: &str, mode: WipeMode) -> Result<WipeResult, String> {
    let backend = backend_path();
    if !backend.exists() {
        return Err(format!("Backend script not found: {}", backend.display()));
    }

    let mode_arg = match mode {
        WipeMode::Quick => "quick",
        WipeMode::Secure => "secure",
    };

    let user = current_user();
    let backend_str = backend.to_string_lossy().to_string();

    let output = Command::new("pkexec")
        .args([&backend_str, mode_arg, device, &user])
        .output()
        .map_err(|e| format!("Failed to launch pkexec: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("dismissed") || stderr.contains("Not authorized") {
            return Err("Authentication cancelled".into());
        }
        return Err(format!("Wipe failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse the JSON line from the backend output
    let json_line = stdout.lines().last()
        .ok_or("No output from backend")?;

    serde_json::from_str::<WipeResult>(json_line)
        .map_err(|e| format!("Failed to parse backend output: {e}\nRaw: {json_line}"))
}
