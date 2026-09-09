package com.semyonsw.habitmaker;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * "Save as..." with the real Android file browser.
 *
 * ACTION_CREATE_DOCUMENT is the Storage Access Framework's file browser. You
 * pick the folder and the filename, Android hands back a content:// URI, and we
 * write the bytes into it. The file ends up exactly where you put it, visible to
 * every other app, with no storage permission needed -- the user granting access
 * to that one URI IS the permission.
 *
 * THE ONE THING TO UNDERSTAND HERE: the file already exists, and is empty,
 * before this code gets a chance to write anything. SAF creates it the moment
 * the user taps Save, and only then returns the URI. So every failure after
 * that point -- a lost payload, a provider that rejects the write mode, a
 * throw halfway -- leaves a 0-byte file sitting exactly where the user expects
 * their backup. That is not a missing export, it is a worse one: a file that
 * looks like a backup and would restore nothing.
 *
 * Hence the shape of this class:
 *
 *   - the payload is decoded and checked BEFORE the picker opens, so a write
 *     that cannot succeed never creates a file at all;
 *   - the bytes are staged (in memory and in the cache dir) so they survive
 *     this activity being recreated, or the process killed, while DocumentsUI
 *     is in front;
 *   - the write is verified against the size the provider reports afterwards;
 *   - anything short of a complete, verified write DELETES the document and
 *     reports the failure. Success is never claimed over an empty file.
 *
 * `cap sync` only wires up plugins that come from npm packages, so this one is
 * registered by hand in MainActivity.onCreate(), BEFORE super.onCreate(), which
 * is where the bridge is built.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    private static final String TAG = "FileSaver";

    /** Where the bytes wait while the file browser is in front. */
    private static final String STAGED_NAME = "filesaver-pending.bin";

    /**
     * The decoded bytes, held from save() until the picker returns.
     *
     * Static, and mirrored into the cache directory, because the picker is a
     * separate activity: DocumentsUI is heavy, and while it is in the
     * foreground Android is free to recreate this activity or kill the whole
     * process -- taking the saved PluginCall, and the payload inside it, with
     * it. Reading the payload back out of the call in the callback (which is
     * what this used to do) is what turned that into an empty backup file.
     */
    private static byte[] pendingBytes;

    /**
     * Open the picker. `data` is base64; the bridge cannot carry raw bytes.
     * Resolves { saved: true, name, uri, bytes } or { saved: false, cancelled: true },
     * and rejects rather than resolve anything for a file it could not fill.
     */
    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename", "export.json");
        String mimeType = call.getString("mimeType", "application/json");

        // Decoded up front, so a payload that cannot be written never gets as
        // far as creating a file to not write it into.
        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("The backup could not be decoded, so nothing was saved.");
            return;
        }
        if (bytes == null || bytes.length == 0) {
            call.reject("There was nothing to save: the backup arrived empty.");
            return;
        }

        pendingBytes = bytes;
        stage(bytes);

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);

        startActivityForResult(call, intent, "onDocumentCreated");
    }

    @ActivityCallback
    private void onDocumentCreated(PluginCall call, ActivityResult result) {
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        boolean cancelled = result.getResultCode() != Activity.RESULT_OK || uri == null;

        // Taken, not read: this payload is spent either way, and leaving it
        // behind would let the next export write the previous one's bytes.
        byte[] bytes = takePending();

        if (cancelled) {
            resolveCancelled(call);
            return;
        }

        if (bytes == null || bytes.length == 0) {
            // The payload did not survive the trip. The document exists and is
            // empty; remove it rather than leave a file that looks like a
            // backup and holds nothing.
            deleteDocument(uri);
            reject(call, "The backup was lost while the file browser was open. Please export again.");
            return;
        }

        try {
            long written = write(uri, bytes);
            if (written != bytes.length) {
                deleteDocument(uri);
                reject(
                    call,
                    "Only " + written + " of " + bytes.length + " bytes reached the file, so it was removed."
                );
                return;
            }

            // The call can be gone -- the process may have been killed while
            // the picker was up. The file is written correctly either way,
            // which is the whole point of staging the bytes; there is simply
            // nobody left to tell.
            if (call != null) {
                JSObject ok = new JSObject();
                ok.put("saved", true);
                ok.put("uri", uri.toString());
                ok.put("name", displayName(uri));
                ok.put("bytes", bytes.length);
                call.resolve(ok);
            }
        } catch (Exception error) {
            deleteDocument(uri);
            if (call != null) {
                call.reject("Could not write the file: " + error.getMessage(), error);
            }
        }
    }

    /**
     * Write the bytes, then report the size the provider actually holds.
     */
    private long write(Uri uri, byte[] bytes) throws IOException {
        // "wt" truncates, which matters when the user picks an EXISTING file
        // and the new backup is shorter than the old one -- without truncation
        // the old tail survives past the end of the new JSON and the file no
        // longer parses. Not every provider implements the mode, though, and an
        // unsupported one throws rather than degrading, so plain "w" is the
        // fallback.
        OutputStream out = openOutputStream(uri, "wt");
        if (out == null) {
            out = openOutputStream(uri, "w");
        }
        if (out == null) {
            throw new IOException("the chosen file could not be opened for writing");
        }

        try {
            out.write(bytes);
            out.flush();
        } finally {
            // close() is what commits the write. A failure here means the file
            // on disk is not what we think it is, so it must reach the caller.
            out.close();
        }

        return sizeOf(uri, bytes.length);
    }

    private OutputStream openOutputStream(Uri uri, String mode) {
        try {
            return getContext().getContentResolver().openOutputStream(uri, mode);
        } catch (Exception error) {
            Logger.warn(TAG, "openOutputStream(\"" + mode + "\") failed: " + error.getMessage());
            return null;
        }
    }

    /**
     * The size the provider reports for the document, or `fallback` when it
     * will not say. A provider that cannot answer must not be mistaken for a
     * failed write -- only one that answers with a different number is.
     */
    private long sizeOf(Uri uri, long fallback) {
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
            // Fall through: unknown is not the same as wrong.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return fallback;
    }

    /* ------------------------------------------------------------- staging */

    private File stagedFile() {
        return new File(getContext().getCacheDir(), STAGED_NAME);
    }

    private void stage(byte[] bytes) {
        try (FileOutputStream out = new FileOutputStream(stagedFile())) {
            out.write(bytes);
            out.flush();
        } catch (IOException error) {
            // The belt to the in-memory braces. If staging fails the export
            // still works for as long as the process survives the picker.
            Logger.warn(TAG, "could not stage the payload: " + error.getMessage());
        }
    }

    private byte[] takePending() {
        byte[] bytes = pendingBytes;
        pendingBytes = null;

        File staged = stagedFile();
        if (bytes == null || bytes.length == 0) {
            bytes = readStaged(staged);
        }
        if (staged.exists() && !staged.delete()) {
            Logger.warn(TAG, "could not remove the staged payload");
        }
        return bytes;
    }

    private byte[] readStaged(File file) {
        if (!file.exists()) {
            return null;
        }
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toByteArray();
        } catch (IOException error) {
            Logger.warn(TAG, "could not read the staged payload: " + error.getMessage());
            return null;
        }
    }

    /* ------------------------------------------------------------ plumbing */

    /** Remove a document that was created but could not be filled. */
    private void deleteDocument(Uri uri) {
        try {
            DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
        } catch (Exception error) {
            // Not every provider allows it, and there is nothing else to try.
            // The caller is being told about the failure regardless.
            Logger.warn(TAG, "could not remove the empty document: " + error.getMessage());
        }
    }

    private void resolveCancelled(PluginCall call) {
        if (call == null) {
            return;
        }
        JSObject cancelled = new JSObject();
        cancelled.put("saved", false);
        cancelled.put("cancelled", true);
        call.resolve(cancelled);
    }

    private void reject(PluginCall call, String message) {
        Logger.warn(TAG, message);
        if (call != null) {
            call.reject(message);
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
