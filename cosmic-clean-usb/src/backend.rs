//! Backend for privileged USB operations. Invoked via pkexec.
//! Usage: cosmic-clean-usb --backend wipe <quick|secure> <device> <user>

use std::io::Write;
use std::path::Path;
use std::process::Command;

use crate::usb::{WipeMode, WipeResult};

pub fn run(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Usage: --backend wipe <quick|secure> <device> <user>".into());
    }

    match args[0].as_str() {
        "wipe" => {
            if args.len() < 4 {
                return Err("Usage: --backend wipe <quick|secure> <device> <user>".into());
            }
            let mode = match args[1].as_str() {
                "quick" => WipeMode::Quick,
                "secure" => WipeMode::Secure,
                other => return Err(format!("Unknown mode: {other}")),
            };
            let device = &args[2];
            let user = &args[3];

            // Safety: verify it's a USB device
            let tran = cmd_output("lsblk", &["-dnpo", "TRAN", device])?;
            if tran.trim() != "usb" {
                return Err(format!("{device} is not a USB device (transport: {})", tran.trim()));
            }

            let result = wipe(device, mode, user)?;
            let json = serde_json::to_string(&result)
                .map_err(|e| format!("JSON serialize failed: {e}"))?;
            println!("{json}");
            Ok(())
        }
        other => Err(format!("Unknown command: {other}")),
    }
}

fn wipe(device: &str, mode: WipeMode, user: &str) -> Result<WipeResult, String> {
    check_deps()?;

    let size = cmd_output("lsblk", &["-dnpo", "SIZE", device])?.trim().to_string();
    let model = cmd_output("lsblk", &["-dnpo", "MODEL", device])?.trim().to_string();
    let usb_version = get_usb_version(device);
    let action = match mode {
        WipeMode::Quick => "Quick wipe".to_string(),
        WipeMode::Secure => "Secure wipe".to_string(),
    };

    // Unmount all partitions
    let parts_output = cmd_output("lsblk", &["-npo", "NAME,MOUNTPOINT", device])?;
    for line in parts_output.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() >= 2 {
            let _ = Command::new("umount").arg(fields[0]).status();
        }
    }

    // Wipe filesystem signatures
    cmd_run("wipefs", &["--all", "--force", device])?;

    // Zero
    match mode {
        WipeMode::Secure => {
            // Full zero — dd returns non-zero when disk fills, that's expected
            let _ = Command::new("dd")
                .args(["if=/dev/zero", &format!("of={device}"), "bs=4M", "status=none", "conv=fsync"])
                .status();
        }
        WipeMode::Quick => {
            // Zero first 1 MiB
            let _ = Command::new("dd")
                .args(["if=/dev/zero", &format!("of={device}"), "bs=1M", "count=1", "status=none"])
                .status();
            // Zero last 1 MiB
            let sectors: u64 = cmd_output("blockdev", &["--getsz", device])?
                .trim().parse().unwrap_or(0);
            let sector_size: u64 = cmd_output("blockdev", &["--getss", device])?
                .trim().parse().unwrap_or(512);
            let total = sectors * sector_size;
            if total > 1_048_576 {
                let offset = total - 1_048_576;
                let _ = Command::new("dd")
                    .args([
                        "if=/dev/zero", &format!("of={device}"),
                        "bs=1", "count=1048576",
                        &format!("seek={offset}"), "status=none",
                    ])
                    .status();
            }
        }
    }

    // Label from model (exFAT max 11 chars, no spaces to avoid path issues)
    let label: String = model.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(11)
        .collect();
    let label = if label.is_empty() { "USB".to_string() } else { label };

    // Partition
    cmd_run("parted", &["-s", device, "mklabel", "gpt"])?;
    cmd_run("parted", &["-s", device, "mkpart", "primary", "1MiB", "100%"])?;
    cmd_run("parted", &["-s", device, "set", "1", "msftdata", "on"])?;
    let _ = Command::new("partprobe").arg(device).status();
    std::thread::sleep(std::time::Duration::from_secs(1));

    // Partition path
    let part = if device.ends_with(|c: char| c.is_ascii_digit()) {
        format!("{device}p1")
    } else {
        format!("{device}1")
    };

    if !Path::new(&part).exists() {
        return Err(format!("Partition {part} not found after partitioning"));
    }

    // Format
    cmd_run("mkfs.exfat", &["-L", &label, &part])?;

    // Mount
    let mount_point = format!("/media/{user}/{label}");
    let _ = std::fs::create_dir_all(&mount_point);

    let uid = cmd_output("id", &["-u", user])?.trim().to_string();
    let gid = cmd_output("id", &["-g", user])?.trim().to_string();
    cmd_run("mount", &["-o", &format!("uid={uid},gid={gid}"), &part, &mount_point])?;

    // Integrity check
    let integrity = verify_integrity(&mount_point);

    // Benchmark
    let (write_speed, read_speed) = benchmark(&mount_point);

    // Write markdown report
    let _ = write_report(user, &model, &size, &usb_version, &write_speed, &read_speed, &integrity, &action);

    Ok(WipeResult {
        device: device.to_string(),
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

    let _ = Command::new("dd")
        .args(["if=/dev/urandom", &format!("of={test_file}"), "bs=1M", "count=4", "status=none"])
        .status();
    let _ = Command::new("sync").status();

    let sum1 = cmd_output("md5sum", &[&test_file]).unwrap_or_default();
    let sum1 = sum1.split_whitespace().next().unwrap_or("");

    let _ = std::fs::write("/proc/sys/vm/drop_caches", "3");

    let sum2 = cmd_output("md5sum", &[&test_file]).unwrap_or_default();
    let sum2 = sum2.split_whitespace().next().unwrap_or("");

    let _ = std::fs::remove_file(&test_file);

    if !sum1.is_empty() && sum1 == sum2 { "PASS".into() } else { "FAIL".into() }
}

fn benchmark(mount_point: &str) -> (String, String) {
    let test_file = format!("{mount_point}/.cleanusb_benchmark");

    let write_output = Command::new("dd")
        .args(["if=/dev/zero", &format!("of={test_file}"), "bs=1M", "count=16", "conv=fsync"])
        .output();
    let write_speed = parse_dd_speed(write_output);

    let _ = std::fs::write("/proc/sys/vm/drop_caches", "3");

    let read_output = Command::new("dd")
        .args([&format!("if={test_file}"), "of=/dev/null", "bs=1M", "count=16"])
        .output();
    let read_speed = parse_dd_speed(read_output);

    let _ = std::fs::remove_file(&test_file);
    (write_speed, read_speed)
}

fn parse_dd_speed(output: Result<std::process::Output, std::io::Error>) -> String {
    match output {
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            // dd output: "... copied, 5.2 s, 12.3 MB/s"
            stderr.lines().last()
                .and_then(|line| line.rsplit(", ").next())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "N/A".into())
        }
        Err(_) => "N/A".into(),
    }
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

fn write_report(
    user: &str, model: &str, size: &str, usb_ver: &str,
    write_spd: &str, read_spd: &str, integrity: &str, action: &str,
) -> Result<(), std::io::Error> {
    let report_path = format!("/home/{user}/usb-report.md");
    let needs_header = !Path::new(&report_path).exists();

    let mut f = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&report_path)?;

    if needs_header {
        writeln!(f, "# USB Drive Report\n")?;
        writeln!(f, "| Date | Name | Size | USB Type | Write Speed | Read Speed | Integrity | Action |")?;
        writeln!(f, "|------|------|------|----------|-------------|------------|-----------|--------|")?;
    }

    let date = chrono::Local::now().format("%Y-%m-%d %H:%M");
    writeln!(f, "| {date} | {model} | {size} | {usb_ver} | {write_spd} | {read_spd} | {integrity} | {action} |")?;

    // Ensure user owns the file
    let _ = Command::new("chown")
        .args([&format!("{user}:{user}"), &report_path])
        .status();

    Ok(())
}

fn check_deps() -> Result<(), String> {
    for cmd in ["lsblk", "wipefs", "parted", "mkfs.exfat", "dd", "md5sum"] {
        if Command::new("which").arg(cmd).output()
            .map(|o| !o.status.success()).unwrap_or(true)
        {
            return Err(format!("'{cmd}' not found. Install with: sudo apt install parted exfatprogs"));
        }
    }
    Ok(())
}

fn cmd_output(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(cmd).args(args).output()
        .map_err(|e| format!("{cmd} failed: {e}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn cmd_run(cmd: &str, args: &[&str]) -> Result<(), String> {
    let status = Command::new(cmd).args(args).status()
        .map_err(|e| format!("{cmd} failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        let args_str = args.join(" ");
        Err(format!("{cmd} {args_str} returned non-zero"))
    }
}
