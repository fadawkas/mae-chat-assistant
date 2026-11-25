# Mae Browser Helper

This unpacked Chromium extension runs in **your** browser profile. It does not run a browser remotely, install a desktop, or grant Mae ongoing access. It can read one visible HTML table you select. It cannot click links, type, sign in, execute commands, read local files, take screenshots, or submit anything to the selected site.

## Pair a run

1. In the Chromium/Chrome profile you want to use, open `chrome://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select this `browser-helper/` directory. Pin **Mae Browser Helper** if desired.
2. Open the helper and choose **Set up Mae connection**. Enter and approve your Mae origin. Use HTTPS for a network-hosted Mae; HTTP works only on loopback for local testing. This sets the destination for future runs, not access to your browser tabs. Use **Disconnect helper** in setup to remove the destination permission.
3. In Mae chat, enter a task, for example: “Export the selected table to a spreadsheet and keep its headers.” Select **Use a table from my browser** and send the message.
4. Choose **Get browser grant code** and copy it. Open the helper *on the tab you want to share* and paste the code.
5. Choose **List tables in this tab**, select a table, verify the displayed source, and choose **Share selected table**. The grant accepts one upload for that run. Close the popup to discard its local selection.
6. Use **Revoke run access** in the helper to stop the active run, or **Stop** in Mae. Revoking does not undo a file already saved or a model request already sent. If the helper is closed, disconnected, denied permission, or never shares data, Mae waits and then marks the run incomplete. Start a new run once the helper is available.

Only use sites you have permission to use. The helper sends the selected table's visible cell text, page title, and origin/path; it omits query strings, fragments and credentials. **Mae can send that text to the configured model provider.** Do not select sensitive data. If a workflow requires an external write or a desktop/native app, do that step yourself; the helper has no such capability.

The helper supports ordinary HTML tables in the main page, up to 151 rows, 20 cells per row, and 32 KB. It rejects merged or nested tables instead of silently changing their structure. Browser grants are short-lived, scoped to a single run, and cannot be reused for another task.
