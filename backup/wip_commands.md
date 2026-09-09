  # 1. SANITY CHECK — confirm sdb is the Passport (1TB WD).
  #    Should show: sdb / Passport / 931.5G / WD / WDC WD10JMVW-...
  lsblk -o NAME,LABEL,SIZE,MOUNTPOINT,VENDOR,MODEL /dev/sdb

  # 2. Unmount the partition
  sudo umount /dev/sdb1

  # 3. Wipe with zeros (~3-4 hours over USB 3.0).
  #    Will print live MB/s. Will exit with "No space left on device" — that's normal, means
  the disk is fully zeroed.
  sudo dd if=/dev/zero of=/dev/sdb bs=4M status=progress oflag=direct

  # 4. New GPT + single partition spanning the whole disk
  sudo parted /dev/sdb --script mklabel gpt mkpart primary 0% 100%

  # 5. Format as exFAT, label "Passport"
  sudo mkfs.exfat -L Passport /dev/sdb1

  # 6. Verify
  lsblk -o NAME,LABEL,SIZE,FSTYPE /dev/sdb

  Tips while step 3 runs:
  - Want a progress check from another terminal? sudo pkill -USR1 dd — prints current status
  without interrupting.
  - Don't sleep/suspend the laptop during the wipe — USB power loss could halt it midway.
  (Resume is fine; you can re-run dd and it'll start fresh.)
  - Keep it plugged into a USB 3.0 port (blue) for full speed. USB 2.0 would take ~10× longer.
