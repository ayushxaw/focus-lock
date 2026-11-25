# Focus Lock

Focus Lock keeps bringing you back to one window in GNOME when you switch away.
You can still use the keyboard and mouse in that window, including in its own
dialogs. To end the session, enter your Focus Lock PIN.

## When to use it

- **Study without app-hopping.** Lock focus to your notes, a PDF reader, or a
  practice app. If you switch to a chat or another app out of habit, Focus Lock
  brings you back to what you were studying.
- **Let someone use a single app.** Open a game, drawing app, or exercise before
  handing the laptop to someone you trust. They can play or work in that window
  without accidentally switching to another app.
- **Stay on a task during a demo.** Keep the slide deck, editor, or demo window
  in focus while you work or share your screen.

If people should be able to see the screen while the keyboard and mouse are
blocked, use [Input Lock X](https://github.com/ayushxaw/input-lock-x).

Focus Lock controls window focus. Closing the selected window or disabling the
extension ends the session, and content and navigation inside the app remain
available. Use GNOME's screen lock for an unattended laptop or a separate
account for private files.

## Install

You need GNOME Shell 45–50, Python 3.9 or newer, and Git. Keep the checkout where
you want it installed, since GNOME loads the extension through a symlink.

```bash
git clone https://github.com/ayushxaw/focus-lock.git
cd focus-lock
./pin.py --set-pin
extensions="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
mkdir -p "$extensions"
ln -sT -- "$(pwd -P)" "$extensions/focuslock@kavinda"
```

If another copy already occupies that extension path, back it up outside the
extensions directory before creating the link. If the path already links to
this checkout, continue to the next step.

Sign out of GNOME and sign back in, then run the command to enable the extension.

```bash
gnome-extensions enable focuslock@kavinda
```

## Use Focus Lock

1. Focus your target window and click the open circle in the GNOME top bar.
2. To end the session, click the filled circle, enter your Focus Lock PIN, and
   press Enter. Incorrect attempts increase the wait before you can try again.

## Set or change your PIN

Open Terminal in your Focus Lock folder and run:

```bash
./pin.py --set-pin
```

Choose 4–12 digits and enter them twice. The new PIN works on your next unlock
attempt. The stored hash stays in your local configuration folder.

If you forget the PIN, close the focused window or disable Focus Lock in the
Extensions app. Then run the same command to choose a new PIN. For the terminal
commands to disable, enable, or check the extension, see [HELPER.txt](HELPER.txt).

## Credits and license

Ayush (ayushxaw) adapted Kavinda Mihiran's Focus Lock on 2026-11-25 and
added PIN setup and unlock.
It is distributed under the GNU General Public License v3.0.
[Original Focus Lock project](https://github.com/kavindamihiran/Linux-Focus) ·
[License](LICENSE)
