# Linux computer

The Computer tab is a QEMU machine shown with noVNC. It is not a screenshot and not a fake desktop.

## What the download contains

The GitHub installer and the portable `.exe` are the Relay app. They do not contain:

- an Ubuntu disk image
- a QEMU binary
- a Windows hypervisor installer

On first provision, Relay downloads `noble-server-cloudimg-amd64.img` from `https://cloud-images.ubuntu.com/noble/current/` and checks it against `SHA256SUMS` from the same directory. The UI says that the GPG signature of the checksum file was not checked.

QEMU must already be installed. On Windows, install QEMU yourself and leave `qemu-system-x86_64.exe` on `PATH` or in `C:\Program Files\qemu`. Relay asks QEMU for WHPX. It does not turn on the Windows Hypervisor Platform feature.

## Checks before download

Relay reads:

- whether `qemu-system-x86_64` exists
- whether `/dev/kvm` exists on Linux
- free memory reported by the OS (asks for 1.5 GiB)
- free disk in the data directory (asks for 12 GiB)

If KVM is missing, software emulation runs only after you check the approval box. If reported memory is low, you can approve continuing. Relay does not close other programs or change host settings.

## Guest

Ubuntu 24.04 cloud image, with cloud-init installing XFCE, Xorg, and a `startx` service. The serial log is the installation progress. The framebuffer is blank or textual until the guest actually starts X. Relay does not show a "desktop ready" state it cannot see.

The guest user is `relay`. The password is generated per VM and shown in the Computer tab. It is a local display password, not an API key.

## Your files

No host directory is shared by default. Sharing asks for an absolute path and `confirmShare: true`. The default share is read-only unless you allow writes. The 9p tag is `hostshare`. Relay does not mount the rest of the disk.

## Shutdown

Shut down sends QEMU `system_powerdown`. Pause sends `stop`. Resume sends `cont`, or starts the process again if it is gone. Force stop sends `SIGTERM` to the pid Relay started. Deleting the VM requires the text `delete this vm` and only removes Relay's own directory, after the process has stopped.

## What was tested here

On the Linux build machine, unit tests checked checksum rejection, the QEMU argument list, and a live preflight that saw `qemu-system-x86_64` and reported `/dev/kvm` according to whether this process could use it. A full Ubuntu download and graphical boot is not part of `npm test`. Run it from the Computer tab when you want the image.
