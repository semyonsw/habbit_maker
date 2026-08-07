package com.semyonsw.habitmaker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are not picked up by `cap sync` -- that only wires up npm
        // packages -- so they have to be registered by hand, and before
        // super.onCreate(), which is where the bridge is built.
        registerPlugin(PdfOpenerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
