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

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

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
 * TWO CALLS, NOT ONE, and that split is the whole point of this file.
 *
 * This used to be a single save() that put the payload into the PluginCall and
 * then launched the picker. The payload therefore had to survive the entire time
 * the user spent browsing folders in another activity -- and when it did not
 * (Android recreates the activity and the WebView under memory pressure, which a
 * megabyte of base64 held in a saved call makes considerably more likely),
 * call.getString("data") came back empty, Base64.decode("") returned a
 * zero-length array, and this class wrote nothing and reported saved:true. The
 * user got a 0 KB file and a success message; re-importing it failed as "not
 * valid JSON", which sent them looking at the importer instead.
 *
 * So: pickSaveLocation() carries no payload and only returns a URI, and write()
 * is a fresh call whose data has to survive nothing at all. write() then reads
 * the file back and counts the bytes before resolving, so a short or empty write
 * is reported as the failure it is rather than announced as a backup.
 *
 * `cap sync` only wires up plugins that come from npm packages, so this one is
 * registered by hand in MainActivity.onCreate(), BEFORE super.onCreate(), which
 * is where the bridge is built.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    /**
     * Open the file browser. Resolves { cancelled: false, uri, name }, or
     * { cancelled: true } if the picker was dismissed.
     *
     * Deliberately takes no payload: see the class comment.
     */
    @PluginMethod
    public void pickSaveLocation(PluginCall call) {
        String filename = call.getString("filename", "export.json");
        String mimeType = call.getString("mimeType", "application/json");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);

        startActivityForResult(call, intent, "onLocationPicked");
    }

    @ActivityCallback
    private void onLocationPicked(PluginCall call, ActivityResult result) {
        // The call can be gone if the process was killed while the picker was
        // up. Nothing to resolve, and nothing has been written.
        if (call == null) {
            return;
        }

        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        JSObject ok = new JSObject();
        ok.put("cancelled", false);
        ok.put("uri", uri.toString());
        ok.put("name", displayName(uri));
        call.resolve(ok);
    }

    /**
     * Write to a URI that pickSaveLocation() returned.
     *
     * `text` is written as UTF-8; `data` is base64 for anything that is not
     * text. Resolves { saved: true, name, uri, bytes, verified } where `bytes`
     * is what the file is confirmed to hold -- not what we meant to put in it.
     */
    @PluginMethod
    public void write(PluginCall call) {
        String target = call.getString("uri", "");
        if (target == null || target.isEmpty()) {
            call.reject("No file was chosen to write to.");
            return;
        }

        byte[] bytes;
        try {
            bytes = payloadBytes(call);
        } catch (IllegalArgumentException malformed) {
            call.reject("The data to save could not be decoded: " + malformed.getMessage());
            return;
        }

        // Never write an empty file over a document the user just named. An
        // empty save is always a bug somewhere upstream, and reporting it as
        // success is what made the original failure so hard to see.
        if (bytes.length == 0) {
            call.reject("There was nothing to save.");
            return;
        }

        Uri uri = Uri.parse(target);
        try {
            writeTo(uri, bytes);
        } catch (Exception error) {
            call.reject("Could not write the file: " + error.getMessage(), error);
            return;
        }

        // Read it back. A write that silently truncates, or a provider that
        // accepted the stream and stored nothing, is caught here rather than by
        // the user discovering an unusable backup weeks later.
        long onDisk = sizeOnDisk(uri);
        if (onDisk >= 0 && onDisk != bytes.length) {
            call.reject(
                "The file was written but holds " + onDisk + " bytes instead of " + bytes.length + "."
            );
            return;
        }

        JSObject ok = new JSObject();
        ok.put("saved", true);
        ok.put("uri", target);
        ok.put("name", displayName(uri));
        ok.put("bytes", onDisk >= 0 ? onDisk : bytes.length);
        // False only where the provider would let us write but not read back.
        ok.put("verified", onDisk >= 0);
        call.resolve(ok);
    }

    /**
     * The bytes to write. `text` is preferred and is what this app actually
     * uses: a backup is JSON, so base64-encoding it only made the string a
     * third longer and added two conversions that could fail.
     */
    private byte[] payloadBytes(PluginCall call) {
        String text = call.getString("text", null);
        if (text != null && !text.isEmpty()) {
            return text.getBytes(StandardCharsets.UTF_8);
        }
        String data = call.getString("data", "");
        if (data == null || data.isEmpty()) {
            return new byte[0];
        }
        // Throws IllegalArgumentException on a malformed payload, which the
        // caller turns into a real message.
        return Base64.decode(data, Base64.DEFAULT);
    }

    private void writeTo(Uri uri, byte[] bytes) throws Exception {
        OutputStream out = openForWriting(uri);
        if (out == null) {
            throw new Exception("the chosen file could not be opened for writing");
        }
        // try-with-resources: close() is what commits the write, and its
        // failure has to reach the caller rather than be swallowed -- while
        // still not masking an exception from write() itself.
        try (OutputStream stream = out) {
            stream.write(bytes);
            stream.flush();
        }
    }

    /**
     * "wt" is write-and-truncate, which is what overwriting an existing backup
     * needs. Not every document provider implements the mode string, so fall
     * back to the default stream rather than failing the export over it.
     */
    private OutputStream openForWriting(Uri uri) throws Exception {
        try {
            OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (out != null) {
                return out;
            }
        } catch (Exception unsupportedMode) {
            // Fall through to the default mode below.
        }
        return getContext().getContentResolver().openOutputStream(uri);
    }

    /**
     * Bytes the file actually holds, or -1 if this provider will not say.
     *
     * Counted by reading the stream rather than trusting OpenableColumns.SIZE,
     * which some providers report as null or as a stale value straight after a
     * write. SIZE is the fallback for a provider that refuses to reopen it.
     */
    private long sizeOnDisk(Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in != null) {
                long total = 0;
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                }
                return total;
            }
        } catch (Exception unreadable) {
            // Fall through to the size column.
        }
        return sizeColumn(uri);
    }

    private long sizeColumn(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext()
                .getContentResolver()
                .query(uri, new String[] { OpenableColumns.SIZE }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (column >= 0 && !cursor.isNull(column)) {
                    return cursor.getLong(column);
                }
            }
        } catch (Exception ignored) {
            // Unverifiable, which is not the same as wrong.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1;
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
