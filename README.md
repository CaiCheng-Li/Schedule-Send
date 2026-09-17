# ScheduleSend

ScheduleSend is a plugin for [Vencord](https://github.com/Vendicated/Vencord), a Discord client mod. You write a message now and pick when it goes out, whether that's in 20 minutes or next Friday at 17:00.

There's no server. Your own Discord app keeps the queue and sends each message when its time comes, so Discord has to be running on the computer you scheduled from. Minimized or in the tray is fine.

## What it does

- Puts a clock button next to the message box. Click it and the text you've typed moves into a dialog where you set the send time.
- Adds `/schedule`, `/scheduled` and `/unschedule` commands.
- Collects everything scheduled across your channels and DMs into one list, where you can send a message early, edit it, or cancel it.
- Scheduled messages survive a Discord restart.
- Shows a notification when a message goes out, and when one couldn't be sent.

## How it works

1. When you schedule a message, the plugin saves the channel, the text, the send time and the account you're logged in as to Discord's local storage.
2. While Discord is open and something is scheduled, the plugin checks the queue at least every 30 seconds. It also checks when the Discord window comes back into view and when your network reconnects.
3. When a message is due, the plugin first confirms the channel still exists and that you're allowed to post there. It saves the message as sending, then passes it to Discord through the same function the message box uses. Messages go out one at a time, 1.5 seconds apart.
4. If Discord accepts it, the message leaves the queue. If Discord turns it down (slowmode, or a permission you lost), it stays in the list as Not sent with Discord's reason next to it.

### What happens when something goes wrong

If Discord closes halfway through a send, the plugin can't tell whether the message went out. On the next start that message shows as Not sent, with a note saying it may have been delivered. The plugin never retries it on its own, so you won't get a duplicate.

Messages only go out from the account that scheduled them. Switch accounts and the other account's messages wait until you switch back.

A message whose time passed while Discord was closed or the computer was asleep counts as missed if it's more than 5 minutes late. You get a notification, and the message stays in the list until you pick Send now or Discard. The Missed messages setting can change this to send them late or throw them away.

Turning the plugin off pauses sending. The queue is still there when you turn it back on.

## Installing on Windows

These steps start from a Windows computer that has none of the tools installed, and use PowerShell. Vencord only loads a plugin like this one when you build Vencord from its source code, which is why there are more steps than a normal Vencord install.

### 1. Install Git, Node.js and pnpm

1. Install [Git](https://git-scm.com/downloads).
2. Install [Node.js](https://nodejs.org/en/download), version 22 or newer.
3. Open a new PowerShell window and install pnpm:

   ```powershell
   npm install -g pnpm
   ```

4. Each of these should print a version number:

   ```powershell
   git --version
   node --version
   pnpm --version
   ```

### 2. Download Vencord

This puts Vencord in your Documents folder. Any folder works.

```powershell
cd $HOME\Documents
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
```

If pnpm warns that the project is configured for pnpm 11.9.0, ignore it. pnpm 12.4.2 installs and builds Vencord with that warning showing.

### 3. Add ScheduleSend

Still in the `Vencord` folder:

```powershell
git clone https://github.com/CaiCheng-Li/Schedule-Send src\userplugins\scheduleSend
```

Keep that folder name and location. It also has to be a real folder: if `scheduleSend` is a shortcut or symlink to somewhere else, the build fails with `Could not resolve "@utils/types"`.

### 4. Build Vencord

```powershell
pnpm build
```

The build goes into `Vencord\dist`, with ScheduleSend included.

### 5. Load your build into Discord

Install the [Discord desktop app](https://discord.com/download) if you haven't, and open it once so it finishes installing. Then quit it from the tray: right-click the Discord icon near the clock and choose Quit Discord. Closing the window leaves Discord running in the background.

From the `Vencord` folder:

```powershell
node src\userplugins\scheduleSend\scripts\inject.mjs
```

It finishes with `Done. Start Discord.` To check the patch later, add `--status`. To undo it, add `--uninject`.

Vencord's own instructions use `pnpm inject` for this step. The current Vencord installer (CLI v1.4.1) prints "Success!" for a self-built Vencord without changing any files, so this repo includes a script that does the installer's job: it renames Discord's `app.asar` to `_app.asar` and writes a small `app.asar` in its place that loads your build.

On Vesktop, skip the script. Open Vesktop's settings, click Change under Vencord Location, choose the `Vencord\dist` folder, then fully restart Vesktop.

### 6. Turn the plugin on

Start Discord and open User Settings, which now has a Vencord section. Go to Vencord, then Plugins, search for ScheduleSend and switch it on. It starts without a restart, and the clock button appears next to the message box.

## Using it

### From the message box

Write your message, then click the clock button. A dialog opens with your text in it. Type when to send it, or pick a shortcut (30 minutes, 1 hour, 3 hours, tomorrow at 9:00) or use the date picker. Under the time box, the dialog shows the date and time it'll send. Click Schedule and your message box empties.

The clock turns blue in any channel that has a message waiting.

### Commands

| Command | What it does |
|---|---|
| `/schedule message: time:` | Schedules a message in the current channel |
| `/scheduled` | Lists this channel's scheduled messages, each with a short ID |
| `/unschedule id:` | Cancels the message with that ID |

The replies are only visible to you.

### The scheduled messages list

Right-click the clock button to open it. The same list is on the plugin's settings page, and in the Vencord toolbox if you have the VencordToolbox plugin on. Messages waiting for a decision sit at the top, and clicking a channel name takes you to that channel.

| Status | Buttons |
|---|---|
| Scheduled | Send now, Edit, Cancel |
| Not sent, Missed | Send now, Reschedule, Discard |

### Time formats

| Type | Examples |
|---|---|
| From now | `90s`, `10m`, `1h30m`, `2 hours 15 min`, `in 3d` |
| Time of day, next occurrence | `15:45`, `9pm`, `9:30 am` |
| Day and time | `today 18:00`, `tomorrow 9am`, `fri 17:00`, `9am monday` |
| Date and time | `2026-12-31 23:59` |

The time has to be between 10 seconds and one year from now.

## Settings

| Setting | Default | Effect |
|---|---|---|
| Missed messages | Ask me what to do | Ask, send them late, or discard them |
| Grace period (minutes) | 5 | Messages up to this many minutes late still send on their own. The lowest allowed value is 2 |
| Notify when sent | On | A notification each time a scheduled message goes out |
| Empty the message box after scheduling | On | Clears the text you scheduled from the message box |

## Limits

- Text only, 2,000 characters at most. No attachments, stickers, polls or replies.
- The queue lives in the app you scheduled from. Discord desktop, Vesktop and Discord in a browser each keep a separate one, and clearing Discord's app data erases it.
- Discord's Terms of Service don't allow automating user accounts. ScheduleSend sends a message you wrote, once, at the time you set, but a program still does the sending. Use it at your own risk.

## Updating

From the `Vencord` folder:

```powershell
git pull
git -C src\userplugins\scheduleSend pull
pnpm install --frozen-lockfile
pnpm build
```

Press Ctrl+R in Discord to load the new build.

When Discord updates itself, it installs into a new `app-` folder, and Vencord copies its patch across when Discord quits. If the Vencord section is missing after an update, quit Discord and run the inject script again.

## Uninstalling

To remove Vencord from Discord, quit Discord and run `node src\userplugins\scheduleSend\scripts\inject.mjs --uninject` from the `Vencord` folder. Do this before deleting anything, since the script lives in the plugin folder.

To remove only ScheduleSend and keep Vencord, switch it off in Vencord's plugin list, delete `src\userplugins\scheduleSend`, run `pnpm build`, and press Ctrl+R in Discord.

## Troubleshooting

| Problem | Fix |
|---|---|
| No Vencord section in Discord's settings | Run the inject script with `--status`. If it says `Patched: no`, quit Discord from the tray and run the script again |
| The script says Discord is running | Discord stays open in the tray after you close its window. Right-click the tray icon and choose Quit Discord |
| ScheduleSend isn't in the plugin list | Make sure the folder is `src\userplugins\scheduleSend`, run `pnpm build`, then press Ctrl+R in Discord |
| Build fails with `Could not resolve "@utils/types"` | The plugin folder is a shortcut or symlink. Delete it and clone the repo straight into `src\userplugins` |
| No clock button | Right-click the message box, open Vencord Buttons, and tick ScheduleSend |

## Development

From the `Vencord` folder:

```powershell
pnpm exec eslint src/userplugins/scheduleSend
pnpm exec tsc --noEmit
pnpm exec tsx --test src/userplugins/scheduleSend/timeParser.test.ts src/userplugins/scheduleSend/queueLogic.test.ts
pnpm build --dev
```

`timeParser.ts` and `queueLogic.ts` import nothing from Discord or Vencord, so their tests run in plain Node.

## License

GPL-3.0-or-later, the same license as Vencord.
