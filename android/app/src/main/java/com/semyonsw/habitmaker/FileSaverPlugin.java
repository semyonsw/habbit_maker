package com.semyonsw.habitmaker;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * "Save as..." with the real Android file browser.
 *
 * Export used to hand the file to the system share sheet. That is fine for
 * sending a backup somewhere, but it is not a place to put a file: there is no
 * folder to choose, several targets copy it somewhere private, and if you
 * dismiss the sheet nothing is written at all. The usual result is a backup you
 * cannot find afterwards.
 *
 * ACTION_CREATE_DOCUMENT is the Storage Access Framework's file browser. You
 * pick the folder and the filename, Android hands back a content:// URI, and we
 * write the bytes into it. The file ends up exactly where you put it, visible to
 * every other app, with no storage permission needed -- the user granting access
 * to that one URI IS the permission.
 *
 * `cap sync` only wires up plugins that come from npm packages, so this one is
 * registered by hand in MainActivity.onCreate(), BEFORE super.onCreate(), which
 * is where the bridge is built.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    /**
     * Open the picker. `data` is base64; the bridge cannot carry raw bytes.
     * Resolves { saved: true, name, uri } or { saved: false, cancelled: true }.
     */
    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename", "export.json");
        String mimeType = call.getString("mimeType", "application/json");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);

        // Keeps the call (and its payload) alive across the activity switch.
        startActivityForResult(call, intent, "onDocumentCreated");
    }

    @ActivityCallback
    private void onDocumentCreated(PluginCall call, ActivityResult result) {
        // The call can be gone if the process was killed while the picker was
        // up. Nothing to resolve, and nothing was written.
        if (call == null) {
            return;
        }

        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("saved", false);
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        OutputStream out = null;
        try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            out = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (out == null) {
                call.reject("Could not open the chosen file for writing.");
                return;
            }
            out.write(bytes);
            out.flush();

            JSObject ok = new JSObject();
            ok.put("saved", true);
            ok.put("uri", uri.toString());
            ok.put("name", displayName(uri));
            call.resolve(ok);
        } catch (Exception error) {
            call.reject("Could not write the file: " + error.getMessage(), error);
        } finally {
            if (out != null) {
                try {
                    // close() is what commits the write. A failure here means
                    // the file on disk is not what we think it is.
                    out.close();
                } catch (Exception ignored) {
                    // Already reported above if the write itself failed.
                }
            }
        }
    }

    /** The name the user actually chose, for the confirmation message. */
    private String displayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext()
                .getContentResolver()
                .query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall through to the URI's last segment.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "your file";
    }
}
