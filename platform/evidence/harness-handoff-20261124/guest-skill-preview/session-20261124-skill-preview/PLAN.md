# R117 forge preview acceptance

The launch requires the exclusive VM slot. Use one AArch64 R117 TCG guest at AI_World commit 73db41e931cc0bcbbd6a5014bf7ce5b6cd21f9bf. The session directory must have no previous village or guest output. The launcher checks HEAD, absence of an incumbent QEMU and fixture composition before startup. Both server and VM lifetimes are bounded.

Use real mouse/keyboard input from ../guest_ui.py. Record guest/01-map, 02-board, 03-forge, 04-skill-card, 05-preview, and 06-preview-bottom as necessary. Review current frame before choosing coordinates. Keep a screenshot of the collapsed summary then capture the open front matter, ID, body and tool list. If the panel cuts off the bottom, position the pointer over the panel and scroll in the guest. Keep the last new frame and quit with 99-quit. Use fixture.py verify while the server is running. Capture receipt for both process exits.

expected-SKILL.md contains 539 host-generated UTF-8 bytes. The guest screenshot comparison checks visible text; it cannot certify original bytes or the trailing newline. The prior unmodified guest-forged skill has 134 characters of instructions and two allowed inputs. This is an isolated local demonstration with no model, download, clipboard or policy changes.
