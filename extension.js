/* Focus Lock Extension for GNOME Shell 45+
 * Locks window focus to a specific application
 * Works on Wayland and X11
 * Adapted by ayushxaw on 2026-11-25 with PIN unlock and window focus fixes.
 */

import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UNLOCKED_ICON = '◎';  // Open circle - green
const LOCKED_ICON = '◉';    // Filled circle - red
const BLOCKED_NOTIFY_COOLDOWN_MS = 5000;

export default class FocusLockExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._button = null;
        this._label = null;
        this._buttonClickHandlerId = null;
        this._isLocked = false;
        this._lockedWindow = null;
        this._lockedAppName = null;
        this._lastBlockedNotifyTime = 0;
        this._focusHandlerId = null;
        this._workspaceHandlerId = null;
        this._focusTimeoutId = null;
        this._minimizedHandlerId = null;
        this._unlockDialog = null;
        this._pinCheck = null;
        this._failedAttempts = 0;
        this._nextPinAttempt = 0;
        this._unmanagedId = null;
    }

    enable() {
        // Create a simple St.Button and add it to the panel
        this._button = new St.Button({
            reactive: true,
            can_focus: true,
            accessible_name: 'Focus Lock: off',
            track_hover: true,
            style_class: 'panel-button focus-lock-indicator unlocked',
        });

        this._label = new St.Label({
            text: UNLOCKED_ICON,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._button.set_child(this._label);

        this._buttonClickHandlerId = this._button.connect('clicked', () => {
            this._toggleLock();
        });

        // Add to the right side of the panel
        Main.panel._rightBox.insert_child_at_index(this._button, 0);
        this._migratePin();
    }

    disable() {
        this._unlock();

        if (this._buttonClickHandlerId) {
            if (this._button) {
                this._button.disconnect(this._buttonClickHandlerId);
            }
            this._buttonClickHandlerId = null;
        }

        if (this._label) {
            this._label.destroy();
            this._label = null;
        }

        if (this._button) {
            Main.panel._rightBox.remove_child(this._button);
            this._button.destroy();
            this._button = null;
        }
    }

    _toggleLock() {
        if (this._isLocked) {
            this._promptForPin();
        } else {
            this._lock();
        }
    }

    _pinHelper(command, flags = Gio.SubprocessFlags.NONE) {
        return Gio.Subprocess.new(
            ['/usr/bin/python3', this.dir.get_child('pin.py').get_path(), command],
            flags,
        );
    }

    _migratePin() {
        try {
            const migration = this._pinHelper('--migrate');
            migration.wait_check_async(null, (process, result) => {
                try {
                    process.wait_check_finish(result);
                } catch (error) {
                    console.warn(`[Focus Lock] PIN migration failed: ${error.message}`);
                }
            });
        } catch (error) {
            console.warn(`[Focus Lock] Could not start PIN migration: ${error.message}`);
        }
    }

    _pinConfigured() {
        const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-lock', 'pin']);
        return Gio.File.new_for_path(path).query_exists(null);
    }

    _checkPin(dialog, entry, message) {
        if (this._pinCheck)
            return;

        const pin = entry.get_text();
        entry.set_text('');
        const now = GLib.get_monotonic_time();
        if (now < this._nextPinAttempt) {
            const remaining = Math.ceil((this._nextPinAttempt - now) / GLib.USEC_PER_SEC);
            message.description = `Wait ${remaining} seconds before trying again.`;
            return;
        }

        let process;
        try {
            process = this._pinHelper('--verify', Gio.SubprocessFlags.STDIN_PIPE);
        } catch (error) {
            console.warn(`[Focus Lock] Could not start PIN verification: ${error.message}`);
            message.description = 'Could not verify the PIN. Check your Focus Lock setup.';
            return;
        }

        this._pinCheck = process;
        // Keep the PIN out of process arguments and validate input length before sending.
        const input = /^[0-9]{4,12}$/.test(pin) ? pin : '';
        process.communicate_utf8_async(input, null, (child, result) => {
            this._pinCheck = null;
            let status = 2;
            try {
                child.communicate_utf8_finish(result);
                if (child.get_if_exited())
                    status = child.get_exit_status();
            } catch (error) {
                console.warn(`[Focus Lock] PIN verification failed: ${error.message}`);
            }

            if (status === 1) {
                this._failedAttempts++;
                const delay = Math.min(30, 2 ** Math.min(5, this._failedAttempts - 1));
                this._nextPinAttempt = GLib.get_monotonic_time() + delay * GLib.USEC_PER_SEC;
            }

            if (this._unlockDialog !== dialog || !this._isLocked)
                return;

            if (status === 0) {
                this._failedAttempts = 0;
                this._nextPinAttempt = 0;
                this._unlock();
            } else {
                message.description = status === 1
                    ? 'Incorrect PIN. Wait briefly before trying again.'
                    : 'Could not read the PIN. Run pin.py --set-pin from the Focus Lock folder.';
                entry.grab_key_focus();
            }
        });
    }

    _promptForPin() {
        if (this._unlockDialog)
            return;

        const dialog = new ModalDialog.ModalDialog({shouldFadeOut: false});
        const message = new Dialog.MessageDialogContent({
            title: 'Unlock Focus Lock',
            description: 'Enter your Focus Lock PIN.',
        });
        const entry = new St.PasswordEntry({
            style_class: 'prompt-dialog-password-entry',
            accessible_name: 'Focus Lock PIN',
            show_peek_icon: false,
            can_focus: true,
            x_expand: true,
        });
        dialog.contentLayout.add_child(message);
        dialog.contentLayout.add_child(entry);
        dialog.setInitialKeyFocus(entry);

        const submit = () => this._checkPin(dialog, entry, message);
        entry.clutter_text.connect('activate', submit);
        dialog.setButtons([
            {label: 'Cancel', key: Clutter.KEY_Escape, action: () => dialog.close()},
            {label: 'Unlock', default: true, action: submit},
        ]);
        dialog.connect('destroy', () => {
            this._unlockDialog = null;
        });
        this._unlockDialog = dialog;
        if (!dialog.open()) {
            dialog.destroy();
            Main.notify('Focus Lock', 'Could not open the PIN prompt. Try again.');
        }
    }

    _lock() {
        if (!this._pinConfigured()) {
            Main.notify('Focus Lock', 'Run pin.py --set-pin from the Focus Lock folder to set your PIN.');
            return;
        }

        const focusedWindow = global.display.get_focus_window();

        if (!focusedWindow) {
            Main.notify('Focus Lock', 'No window is currently focused!');
            return;
        }

        this._lockedWindow = focusedWindow;
        this._isLocked = true;

        // Update UI
        this._label.text = LOCKED_ICON;
        this._button.style_class = 'panel-button focus-lock-indicator locked';
        this._button.accessible_name = 'Focus Lock: on. Enter PIN to unlock.';

        // Connect to focus changes
        this._focusHandlerId = global.display.connect('notify::focus-window', () => {
            this._onFocusChanged();
        });

        this._workspaceHandlerId = global.workspace_manager.connect('active-workspace-changed',
            () => this._refocusLockedWindow());
        this._minimizedHandlerId = focusedWindow.connect('notify::minimized', () => {
            if (focusedWindow.minimized)
                this._refocusLockedWindow();
        });

        // Track if the locked window is closed
        this._unmanagedId = this._lockedWindow.connect('unmanaged', () => {
            if (this._isLocked) {
                this._unlock();
            }
        });

        // Get app name for notification
        const app = Shell.WindowTracker.get_default().get_window_app(focusedWindow);
        const appName = app ? app.get_name() : 'Window';
        this._lockedAppName = appName;
        Main.notify('Focus Lock ON', `Locked to: ${appName}`);
    }

    _unlock() {
        this._unlockDialog?.close();

        if (this._focusHandlerId) {
            global.display.disconnect(this._focusHandlerId);
            this._focusHandlerId = null;
        }

        if (this._workspaceHandlerId) {
            global.workspace_manager.disconnect(this._workspaceHandlerId);
            this._workspaceHandlerId = null;
        }

        if (this._minimizedHandlerId) {
            this._lockedWindow.disconnect(this._minimizedHandlerId);
            this._minimizedHandlerId = null;
        }

        if (this._unmanagedId && this._lockedWindow) {
            try {
                this._lockedWindow.disconnect(this._unmanagedId);
            } catch (_e) {
                // Window may already be destroyed
            }
            this._unmanagedId = null;
        }

        if (this._focusTimeoutId) {
            GLib.Source.remove(this._focusTimeoutId);
            this._focusTimeoutId = null;
        }

        const wasLocked = this._isLocked;
        this._lockedWindow = null;
        this._lockedAppName = null;
        this._lastBlockedNotifyTime = 0;
        this._isLocked = false;

        // Update UI
        if (this._label) {
            this._label.text = UNLOCKED_ICON;
        }
        if (this._button) {
            this._button.style_class = 'panel-button focus-lock-indicator unlocked';
            this._button.accessible_name = 'Focus Lock: off';
        }

        if (wasLocked) {
            Main.notify('Focus Lock OFF', 'Unlocked - you can now switch windows');
        }
    }

    _notifyBlocked() {
        // Throttle so repeated switch attempts don't flood the notification list
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastBlockedNotifyTime < BLOCKED_NOTIFY_COOLDOWN_MS) {
            return;
        }
        this._lastBlockedNotifyTime = now;

        Main.notify('Focus Lock is ON',
            `Locked to ${this._lockedAppName}. Click ${LOCKED_ICON} in the top bar to enter your PIN.`);
    }

    _belongsToLockedWindow(window) {
        for (let parent = window; parent; parent = parent.get_transient_for()) {
            if (parent === this._lockedWindow)
                return true;
        }
        return false;
    }

    _refocusLockedWindow() {
        if (this._focusTimeoutId || !this._lockedWindow)
            return;

        this._focusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._focusTimeoutId = null;
            const window = this._lockedWindow;
            const workspace = global.workspace_manager.get_active_workspace();
            if (!window.located_on_workspace(workspace))
                window.change_workspace(workspace);
            if (window.minimized)
                window.unminimize();
            if (!this._belongsToLockedWindow(global.display.get_focus_window()))
                window.activate(global.get_current_time());
            return GLib.SOURCE_REMOVE;
        });
    }

    _onFocusChanged() {
        const focusedWindow = global.display.get_focus_window();
        if (focusedWindow && !this._belongsToLockedWindow(focusedWindow)) {
            this._notifyBlocked();
            this._refocusLockedWindow();
        }
    }
}
