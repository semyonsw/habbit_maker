package com.semyonsw.habitmaker;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Opens a PDF that already sits in the app cache with whatever app the phone
 * uses to read PDFs.
 *
 * The web layer keeps book bytes in IndexedDB, which no other app can reach, so
 * src/native.js writes the file into the cache first (chunked, via the
 * Filesystem plugin) and then calls this with the cache-relative path.
 *
 * ACTION_SEND through the Share plugin was the alternative and is still the
 * fallback in JS, but it produces a "share to" sheet rather than opening the
 * book, and several readers refuse ACTION_SEND entirely.
 */
@CapacitorPlugin(name = "PdfOpener")
public class PdfOpenerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("A cache-relative path is required.");
            return;
        }

        Context context = getContext();
        File file = new File(context.getCacheDir(), path);
        if (!file.exists()) {
            call.reject("The file is not in the cache: " + path);
            return;
        }

        Uri contentUri;
        try {
            contentUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                file
            );
        } catch (IllegalArgumentException e) {
            call.reject("The file is outside the shareable paths.", e);
            return;
        }

        // Purely advisory: there is no standard Android intent for "open at page
        // N", but the readers built on PDF.js / Chromium do honour the fragment,
        // and the ones that don't simply ignore it.
        int page = call.getInt("page", 1);
        if (page > 1) {
            contentUri = contentUri.buildUpon().fragment("page=" + page).build();
        }

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "application/pdf");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this phone can open PDF files.", e);
            return;
        }

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }
}
