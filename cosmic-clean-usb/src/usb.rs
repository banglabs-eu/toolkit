//! USB device detection and operations via system commands.
//! Requires: lsblk, wipefs, parted, mkfs.exfat, dd

use std::path::{Path, PathBuf};
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

#[derive(Debug, Clone)]
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

/// Mount a device's first partition, return mount point.
pub fn mount_device(device: &str) -> Result<String, String> {
    let user = std::env::var("SUDO_USER")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "root".into());
    let mount_base = format!("/media/{user}");

    let partitions = get_partitions(device);
    let part = partitions.first().ok_or("No partitions found")?;

    // Already mounted?
    if let Some(ref mp) = part.mountpoint {
        return Ok(mp.clone());
    }

    let label = if part.label.is_empty() { "USB" } else { &part.label };
    let mount_point = format!("{mount_base}/{label}");

    Command::new("mkdir").args(["-p", &mount_point]).output().ok();

    let status = Command::new("mount")
        .args([&part.path, &mount_point])
        .status()
        .map_err(|e| format!("mount failed: {e}"))?;

    if status.success() {
        Ok(mount_point)
    } else {
        Err("mount returned non-zero".into())
    }
}

/// Open a path in the default file browser.
pub fn open_in_browser(path: &str) {
    let _ = Command::new("xdg-open").arg(path).spawn();
}

/// Run the wipe operation. This is blocking and should be called from a tokio task.
pub fn wipe_device(device: &str, mode: WipeMode) -> Result<WipeResult, String> {
    let dev = device.to_string();
    let devices = detect_devices();
    let usb = devices.iter().find(|d| d.path == dev)
        .ok_or_else(|| format!("{dev} not found"))?;

    let model = usb.model.clone();
    let size = usb.size.clone();
    let usb_version = usb.usb_version.clone();
    let action = match mode {
        WipeMode::Quick => "Quick wipe",
        WipeMode::Secure => "Secure wipe",
    }.to_string();

    let user = std::env::var("SUDO_USER")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "root".into());
    let mount_base = format!("/media/{user}");

    // Unmount partitions
    for part in &usb.partitions {
        if part.mountpoint.is_some() {
            let _ = Command::new("umount").arg(&part.path).status();
        }
    }

    // Wipe signatures
    let status = Command::new("wipefs")
        .args(["--all", "--force", &dev])
        .status()
        .map_err(|e| format!("wipefs failed: {e}"))?;
    if !status.success() {
        return Err("wipefs failed".into());
    }

    // Zero
    match mode {
        WipeMode::Secure => {
            let status = Command::new("dd")
                .args(["if=/dev/zero", &format!("of={dev}"), "bs=4M", "status=none", "conv=fsync"])
                .status()
                .map_err(|e| format!("dd failed: {e}"))?;
            // dd returns non-zero when disk is full, that's expected
            let _ = status;
        }
        WipeMode::Quick => {
            // Zero first 1 MiB
            let _ = Command::new("dd")
                .args(["if=/dev/zero", &format!("of={dev}"), "bs=1M", "count=1", "status=none"])
                .status();
            // Zero last 1 MiB
            let sectors = run_cmd("blockdev", &["--getsz", &dev]).unwrap_or_default();
            let sector_size = run_cmd("blockdev", &["--getss", &dev]).unwrap_or_default();
            let sectors: u64 = sectors.trim().parse().unwrap_or(0);
            let sector_size: u64 = sector_size.trim().parse().unwrap_or(512);
            let total = sectors * sector_size;
            if total > 1_048_576 {
                let offset = total - 1_048_576;
                let _ = Command::new("dd")
                    .args([
                        "if=/dev/zero", &format!("of={dev}"),
                        "bs=1", "count=1048576",
                        &format!("seek={offset}"), "status=none",
                    ])
                    .status();
            }
        }
    }

    // Label from model (exFAT max 11 chars)
    let label: String = model.chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .collect::<String>()
        .trim()
        .chars()
        .take(11)
        .collect();
    let label = if label.is_empty() { "USB".to_string() } else { label };

    // Partition
    let _ = Command::new("parted").args(["-s", &dev, "mklabel", "gpt"]).status();
    let _ = Command::new("parted").args(["-s", &dev, "mkpart", "primary", "1MiB", "100%"]).status();
    let _ = Command::new("parted").args(["-s", &dev, "set", "1", "msftdata", "on"]).status();
    let _ = Command::new("partprobe").arg(&dev).status();
    std::thread::sleep(std::time::Duration::from_secs(1));

    // Determine partition path
    let part = if dev.ends_with(|c: char| c.is_ascii_digit()) {
        format!("{dev}p1")
    } else {
        format!("{dev}1")
    };

    // Format
    let status = Command::new("mkfs.exfat")
        .args(["-L", &label, &part])
        .status()
        .map_err(|e| format!("mkfs.exfat failed: {e}"))?;
    if !status.success() {
        return Err("mkfs.exfat failed".into());
    }

    // Mount
    let mount_point = format!("{mount_base}/{label}");
    let _ = Command::new("mkdir").args(["-p", &mount_point]).status();

    let uid = run_cmd("id", &["-u", &user]).unwrap_or_default().trim().to_string();
    let gid = run_cmd("id", &["-g", &user]).unwrap_or_default().trim().to_string();

    let _ = Command::new("mount")
        .args(["-o", &format!("uid={uid},gid={gid}"), &part, &mount_point])
        .status();

    // Integrity check
    let integrity = verify_integrity(&mount_point);

    // Benchmark
    let (write_speed, read_speed) = benchmark(&mount_point);

    // Write report
    let _ = write_report(&user, &model, &size, &usb_version, &write_speed, &read_speed, &integrity, &action);

    Ok(WipeResult {
        device: dev,
        model,
        size,
        usb_version,
        label,
        mount_point,
        write_speed,
        read_speed,
        integrity,
        action,
    })
}

fn verify_integrity(mount_point: &str) -> String {
    let test_file = format!("{mount_point}/.cleanusb_verify");

    // Write 16 MiB random data
    let _ = Command::new("dd")
        .args(["if=/dev/urandom", &format!("of={test_file}"), "bs=1M", "count=16", "status=none"])
        .status();
    let _ = Command::new("sync").status();

    let sum1 = run_cmd("md5sum", &[&test_file]).unwrap_or_default();
    let sum1 = sum1.split_whitespace().next().unwrap_or("");

    // Drop caches
    let _ = std::fs::write("/proc/sys/vm/drop_caches", "3");

    let sum2 = run_cmd("md5sum", &[&test_file]).unwrap_or_default();
    let sum2 = sum2.split_whitespace().next().unwrap_or("");

    let _ = std::fs::remove_file(&test_file);

    if !sum1.is_empty() && sum1 == sum2 { "PASS".into() } else { "FAIL".into() }
}

fn benchmark(mount_point: &str) -> (String, String) {
    let test_file = format!("{mount_point}/.cleanusb_benchmark");

    // Write benchmark
    let output = Command::new("dd")
        .args(["if=/dev/zero", &format!("of={test_file}"), "bs=1M", "count=64", "conv=fsync"])
        .output();
    let write_speed = parse_dd_speed(&output);

    // Drop caches
    let _ = std::fs::write("/proc/sys/vm/drop_caches", "3");

    // Read benchmark
    let output = Command::new("dd")
        .args([&format!("if={test_file}"), "of=/dev/null", "bs=1M", "count=64"])
        .output();
    let read_speed = parse_dd_speed(&output);

    let _ = std::fs::remove_file(&test_file);

    (write_speed, read_speed)
}

fn parse_dd_speed(output: &Result<std::process::Output, std::io::Error>) -> String {
    match output {
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            // dd outputs speed in stderr like "67108864 bytes (67 MB, 64 MiB) copied, 5.2 s, 12.3 MB/s"
            stderr.lines().last()
                .and_then(|line| line.rsplit(", ").next())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "N/A".into())
        }
        Err(_) => "N/A".into(),
    }
}

fn run_cmd(cmd: &str, args: &[&str]) -> Option<String> {
    Command::new(cmd).args(args).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
}

fn write_report(
    user: &str, model: &str, size: &str, usb_ver: &str,
    write_spd: &str, read_spd: &str, integrity: &str, action: &str,
) -> Result<(), std::io::Error> {
    let home = std::env::var("HOME")
        .or_else(|_| {
            run_cmd("eval", &[&format!("echo ~{user}")])
                .ok_or(std::env::VarError::NotPresent)
        })
        .unwrap_or_else(|_| format!("/home/{user}"));
    let report_path = format!("{home}/usb-report.md");

    let needs_header = !Path::new(&report_path).exists();
    let mut content = String::new();

    if needs_header {
        content.push_str("# USB Drive Report\n\n");
        content.push_str("| Date | Name | Size | USB Type | Write Speed | Read Speed | Integrity | Action |\n");
        content.push_str("|------|------|------|----------|-------------|------------|-----------|--------|\n");
    }

    let date = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    content.push_str(&format!(
        "| {date} | {model} | {size} | {usb_ver} | {write_spd} | {read_spd} | {integrity} | {action} |\n"
    ));

    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&report_path)?;
    f.write_all(content.as_bytes())?;
    Ok(())
}
